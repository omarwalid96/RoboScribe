"""
RoboScribe WebSocket Bridge Client

Runs in a daemon thread with its own asyncio event loop.
Connects to the FastAPI backend at ws://localhost:8000/sim and:
- Receives execute/stop commands
- Records joint trajectory at 200Hz during execution
- Sends throttled joint_update messages at 20Hz (joint + IMU-equivalent data)
- Sends execution_complete with full trajectory on finish

Camera streaming (RGB + depth) is implemented but commented out.
Re-enable for π0-FAST VLA integration — see the camera capture block
in record_step(). Move to a dedicated thread at 5-10Hz when re-enabling
to avoid CUDA→CPU sync stalls on the physics thread.
"""

import asyncio
import json
import threading
import time
from typing import Callable

import numpy as np

BACKEND_WS_URL = "ws://localhost:8000/sim"
PHYSICS_DT = 1.0 / 200.0
JOINT_UPDATE_INTERVAL = 0.05   # 20Hz
CAMERA_UPDATE_INTERVAL = 0.20  # 5Hz — decoupled from physics loop to avoid CUDA→CPU sync stalls

JOINT_NAMES = [
    "left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
    "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle",
    "torso",
    "left_shoulder_pitch", "left_shoulder_roll", "left_shoulder_yaw", "left_elbow",
    "right_shoulder_pitch", "right_shoulder_roll", "right_shoulder_yaw", "right_elbow",
]


class RoboScribeBridge:
    """
    WebSocket bridge client that runs in a background daemon thread.

    Thread safety note: The bridge thread writes commands via set_command_fn;
    the physics thread reads them. numpy array element assignment is atomic
    enough given the ~20Hz command rate vs 200Hz physics rate.
    """

    def __init__(
        self,
        get_command_fn: Callable,
        set_command_fn: Callable,
        get_robot_fn: Callable,
        get_frame_fn: Callable = None,
        backend_url: str = BACKEND_WS_URL,
    ):
        self._get_command = get_command_fn
        self._set_command = set_command_fn
        self._get_robot = get_robot_fn
        self._get_frame = get_frame_fn   # returns latest numpy RGB (H,W,3) or None
        self._backend_url = backend_url

        # Execution state
        self._executing = False
        self._command_id = None
        self._total_steps = 0
        self._current_step = 0
        self._trajectory = []
        self._start_position = None

        # Multi-step sequence state
        self._steps_plan = []    # [{total_steps, vx, vy, wz}, ...] — empty for single commands
        self._step_index = 0     # which step we're currently executing
        self._step_boundary = 0  # _current_step value at which to advance to next step

        # Live update throttling
        self._last_joint_update_time = 0.0
        self._last_camera_update_time = 0.0
        self._elapsed_time = 0.0
        self._physics_step_count = 0

        # WebSocket and event loop (owned by background thread)
        self._ws = None
        self._loop = None
        self._thread = None
        self._running = False

        # Connection status for UI
        self.connected = False
        self.status_text = "Disconnected"

    # ─── Public API (called from physics thread) ───────────────────────────

    def start(self):
        """Start the background WebSocket thread."""
        self._running = True
        self._thread = threading.Thread(target=self._run_thread, daemon=True, name="RoboScribeBridge")
        self._thread.start()

    def stop(self):
        """Gracefully stop the bridge thread."""
        self._running = False
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)

    def record_step(self, step_size: float):
        """
        Called every physics step (200Hz) from the physics thread.
        Captures trajectory data when executing, sends throttled joint updates always.
        """
        self._elapsed_time += step_size
        self._physics_step_count += 1

        robot = self._get_robot()
        if robot is None:
            return

        # --- Capture trajectory during execution ---
        if self._executing:
            self._current_step += 1

            # Advance to next step in a sequence when the current step's budget is exhausted
            if self._steps_plan and self._current_step >= self._step_boundary:
                self._step_index += 1
                if self._step_index < len(self._steps_plan):
                    next_step = self._steps_plan[self._step_index]
                    self._step_boundary += next_step["total_steps"]
                    self._set_command([next_step["vx"], next_step["vy"], next_step["wz"]])
                    print(f"[RoboScribe Bridge] Sequence step {self._step_index + 1}/{len(self._steps_plan)}: "
                          f"vx={next_step['vx']} vy={next_step['vy']} wz={next_step['wz']}")

            try:
                joint_pos = robot.robot.get_joint_positions().tolist()
                joint_vel = robot.robot.get_joint_velocities().tolist()
                base_pos, base_ori = robot.robot.get_world_pose()
                base_pos = base_pos.tolist()
                base_ori = base_ori.tolist()
                linear_vel = robot.robot.get_linear_velocity().tolist()
                angular_vel = robot.robot.get_angular_velocity().tolist()
            except Exception:
                joint_pos = []
                joint_vel = []
                base_pos = [0.0, 0.0, 0.0]
                base_ori = [1.0, 0.0, 0.0, 0.0]
                linear_vel = [0.0, 0.0, 0.0]
                angular_vel = [0.0, 0.0, 0.0]

            self._trajectory.append({
                "step": self._current_step,
                "t": round(self._current_step * PHYSICS_DT, 4),
                "joint_positions": joint_pos,
                "joint_velocities": joint_vel,
                "base_position": base_pos,
                "base_orientation": base_ori,
                "linear_velocity": linear_vel,
                "angular_velocity": angular_vel,
                "command": self._get_command().tolist() if hasattr(self._get_command(), "tolist") else list(self._get_command()),
            })

            # Progress update every 20 steps
            if self._current_step % 20 == 0:
                dist = self._compute_distance(base_pos)
                self._send_nowait({
                    "type": "execution_progress",
                    "command_id": self._command_id,
                    "current_step": self._current_step,
                    "current_time": round(self._current_step * PHYSICS_DT, 4),
                    "distance_traveled": round(dist, 4),
                })

            # Check completion
            if self._current_step >= self._total_steps:
                self._complete_execution(base_pos)
                return

        # --- Throttled joint update at 20Hz ---
        now = self._elapsed_time
        if (now - self._last_joint_update_time) >= JOINT_UPDATE_INTERVAL:
            self._last_joint_update_time = now
            try:
                robot = self._get_robot()
                if robot is not None:
                    joint_pos = robot.robot.get_joint_positions().tolist()
                    joint_vel = robot.robot.get_joint_velocities().tolist()
                    base_pos, base_ori = robot.robot.get_world_pose()
                    linear_vel = robot.robot.get_linear_velocity().tolist()
                    angular_vel = robot.robot.get_angular_velocity().tolist()
                    cmd = self._get_command()
                    payload = {
                        "type": "joint_update",
                        "step": self._physics_step_count,
                        "t": round(now, 4),
                        "joint_positions": joint_pos,
                        "joint_velocities": joint_vel,
                        "joint_torques": [],  # not available via policy API
                        "base_position": base_pos.tolist(),
                        "base_orientation": base_ori.tolist(),
                        "linear_velocity": linear_vel,
                        "angular_velocity": angular_vel,
                        "command": cmd.tolist() if hasattr(cmd, "tolist") else list(cmd),
                    }
                    
                    # ── Camera capture (disabled — re-enable for π0-FAST VLA integration) ──────
                    # Capturing frames here causes a CUDA→CPU sync stall on every 20Hz tick.
                    # When π0-FAST is integrated, move this block to a dedicated low-frequency
                    # thread (5-10Hz) decoupled from the joint_update loop to avoid physics lag.
                    # The get_camera_fn callback is still wired up in __init__ — just uncomment.
                    #
                    # camera = self._get_camera() if self._get_camera else None
                    # if camera is not None:
                    #     frame = camera.get_current_frame()
                    #     import base64, cv2
                    #
                    #     if "rgb" in frame or "rgba" in frame:
                    #         color_key = "rgba" if "rgba" in frame else "rgb"
                    #         color_img = frame[color_key]
                    #         if len(color_img.shape) == 3 and color_img.shape[-1] == 4:
                    #             bgr_img = cv2.cvtColor(color_img, cv2.COLOR_RGBA2BGR)
                    #         else:
                    #             bgr_img = cv2.cvtColor(color_img, cv2.COLOR_RGB2BGR)
                    #         _, buf = cv2.imencode('.jpg', bgr_img, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    #         payload["image_rgb_b64"] = base64.b64encode(buf).decode("utf-8")
                    #
                    #     depth_key = "distance_to_image_plane"
                    #     if depth_key in frame:
                    #         depth_img = frame[depth_key]
                    #         valid = np.nan_to_num(depth_img, nan=0.0, posinf=0.0, neginf=0.0)
                    #         depth_u8 = cv2.normalize(valid, None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
                    #         _, buf_d = cv2.imencode('.jpg', depth_u8, [cv2.IMWRITE_JPEG_QUALITY, 70])
                    #         payload["image_depth_b64"] = base64.b64encode(buf_d).decode("utf-8")
                    # ─────────────────────────────────────────────────────────────────────────────

                    self._send_nowait(payload)
            except Exception as e:
                print(f"[RoboScribe Bridge] Joint sync error: {e}")

    # ─── Internal helpers ───────────────────────────────────────────────────

    def _compute_distance(self, current_pos):
        if self._start_position is None:
            return 0.0
        dx = current_pos[0] - self._start_position[0]
        dy = current_pos[1] - self._start_position[1]
        return float(np.sqrt(dx * dx + dy * dy))

    def _complete_execution(self, final_base_pos):
        self._executing = False
        dist = self._compute_distance(final_base_pos)
        payload = {
            "type": "execution_complete",
            "command_id": self._command_id,
            "outcome": "success",
            "total_steps": self._current_step,
            "total_duration": round(self._current_step * PHYSICS_DT, 4),
            "distance_traveled": round(dist, 4),
            "joint_names": JOINT_NAMES,
            "trajectory": self._trajectory,
        }
        self._send_nowait(payload)
        # Reset command to zero
        self._set_command([0.0, 0.0, 0.0])
        print(f"[RoboScribe Bridge] Execution complete: command_id={self._command_id}, steps={self._current_step}")

    def _send_nowait(self, payload: dict):
        """Thread-safe fire-and-forget send to the WebSocket."""
        if self._ws is None or not self.connected or self._loop is None:
            return
        msg = json.dumps(payload)
        asyncio.run_coroutine_threadsafe(self._ws.send(msg), self._loop)

    # ─── Background thread ──────────────────────────────────────────────────

    def _run_thread(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        try:
            self._loop.run_until_complete(self._connect_loop())
        finally:
            self._loop.close()

    async def _connect_loop(self):
        import websockets

        backoff_times = [1, 2, 4, 8, 16, 30]
        attempt = 0

        while self._running:
            delay = backoff_times[min(attempt, len(backoff_times) - 1)]
            self.status_text = f"Disconnected (retry in {delay}s)"
            self.connected = False

            if attempt > 0:
                print(f"[RoboScribe Bridge] Disconnected, retrying in {delay}s...")
                await asyncio.sleep(delay)

            if not self._running:
                break

            try:
                print(f"[RoboScribe Bridge] Connecting to {self._backend_url}...")
                async with websockets.connect(self._backend_url) as ws:
                    self._ws = ws
                    self.connected = True
                    self.status_text = f"Connected to {self._backend_url}"
                    attempt = 0
                    print(f"[RoboScribe Bridge] Connected to {self._backend_url}")

                    # Announce ourselves
                    await ws.send(json.dumps({"type": "sim_connected"}))

                    # Camera loop runs alongside message receiver (5Hz, async thread only)
                    camera_task = asyncio.create_task(self._camera_loop())

                    try:
                        # Message receive loop
                        async for raw in ws:
                            if not self._running:
                                break
                            try:
                                msg = json.loads(raw)
                                await self._handle_message(msg)
                            except json.JSONDecodeError:
                                print(f"[RoboScribe Bridge] Bad JSON: {raw}")
                    finally:
                        camera_task.cancel()
                        try:
                            await camera_task
                        except asyncio.CancelledError:
                            pass

            except Exception as e:
                print(f"[RoboScribe Bridge] Connection error: {e}")
                self._ws = None
                self.connected = False
                attempt += 1

        self.status_text = "Stopped"

    async def _camera_loop(self):
        """
        Capture RGB+depth frames at 5Hz and send them to the backend as camera_update.

        Runs in the async WS thread — NOT in the physics callback — to avoid CUDA→CPU
        sync stalls that would lag the 200Hz physics loop.
        """
        while self._running:
            await asyncio.sleep(CAMERA_UPDATE_INTERVAL)
            if not self.connected or self._ws is None:
                continue
            await self._capture_and_send_camera_frame()

    async def _capture_and_send_camera_frame(self):
        """Read the latest cached RGB frame (captured in physics thread) and send it."""
        if self._get_frame is None:
            return
        rgb = self._get_frame()   # numpy (H,W,3) uint8 or None
        if rgb is None or rgb.size == 0:
            return

        try:
            import base64
            import cv2

            bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
            _, buf = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])
            payload = {
                "type": "camera_update",
                "t": round(self._elapsed_time, 4),
                "image_rgb_b64": base64.b64encode(buf).decode("utf-8"),
            }
            await self._ws.send(json.dumps(payload))

        except Exception as e:
            print(f"[RoboScribe Bridge] Camera send error: {e}")

    async def _handle_message(self, msg: dict):
        msg_type = msg.get("type")

        if msg_type == "execute":
            command_id = msg.get("command_id", "unknown")

            # Capture start position for distance calculation
            robot = self._get_robot()
            if robot is not None:
                try:
                    pos, _ = robot.robot.get_world_pose()
                    self._start_position = pos.tolist()
                except Exception:
                    self._start_position = [0.0, 0.0, 0.0]

            raw_steps = msg.get("steps")
            if raw_steps:
                # ── Sequence mode ──────────────────────────────────────
                plan = []
                for s in raw_steps:
                    duration = float(s.get("duration", 1.0))
                    n = int(duration / PHYSICS_DT)
                    plan.append({
                        "total_steps": n,
                        "vx": float(s.get("vx", 0.0)),
                        "vy": float(s.get("vy", 0.0)),
                        "wz": float(s.get("wz", 0.0)),
                    })
                self._steps_plan = plan
                self._step_index = 0
                self._step_boundary = plan[0]["total_steps"]
                self._total_steps = sum(p["total_steps"] for p in plan)
                first = plan[0]
                self._set_command([first["vx"], first["vy"], first["wz"]])
                print(f"[RoboScribe Bridge] Sequence execute: id={command_id} "
                      f"{len(plan)} steps, {self._total_steps} total physics steps")
            else:
                # ── Single command mode (backward compatible) ──────────
                vx = float(msg.get("vx", 0.0))
                vy = float(msg.get("vy", 0.0))
                wz = float(msg.get("wz", 0.0))
                duration = float(msg.get("duration", 1.0))
                self._steps_plan = []
                self._step_index = 0
                self._step_boundary = 0
                self._total_steps = int(duration / PHYSICS_DT)
                self._set_command([vx, vy, wz])
                print(f"[RoboScribe Bridge] Execute: id={command_id} vx={vx} vy={vy} wz={wz} "
                      f"duration={duration}s ({self._total_steps} steps)")

            # Reset execution state
            self._command_id = command_id
            self._current_step = 0
            self._trajectory = []
            self._executing = True

        elif msg_type == "vla_step":
            # Fast-path navigation step from the visual navigation loop.
            # Unlike execute, this does NOT track steps or send execution_complete —
            # the navigation loop drives the cadence externally at 5Hz.
            # Only applied when not in a regular execute sequence.
            if not self._executing:
                vx = float(msg.get("vx", 0.0))
                wz = float(msg.get("wz", 0.0))
                self._set_command([vx, 0.0, wz])

        elif msg_type == "stop":
            self._executing = False
            self._set_command([0.0, 0.0, 0.0])
            print("[RoboScribe Bridge] Stop received")

        else:
            print(f"[RoboScribe Bridge] Unknown message type: {msg_type}")
