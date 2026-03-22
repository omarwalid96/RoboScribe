"""LangGraph-based pipeline orchestrating the full command lifecycle.

Pipeline:
  parse_command → send_confirmation → await_confirmation
      → [confirmed] → dispatch_to_sim → END
      → [rejected / timeout] → END

When Isaac Sim later reports execution_complete, receive_execution_result()
handles the post-execution bookkeeping.

Note: callables (send_to_dashboard, send_to_sim) are stored on the agent
instance keyed by command_id — NOT in AgentState — so state remains
serializable if a checkpointer is ever added.
"""

import asyncio
import logging
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from langgraph.graph import StateGraph, END
from typing_extensions import TypedDict

from command_parser import parse_command_with_llm
from n8n_client import send_observability_event

logger = logging.getLogger(__name__)

# Visual navigation (Florence-2) — graceful degradation if torch/transformers not installed.
# Explicitly test `import torch` here because vision_navigator.py defers it to _load_model(),
# meaning a CUDA library load error (libcudart missing) won't surface until first inference.
try:
    import torch as _torch  # noqa: F401 — load-time check only
    from vision_navigator import NavigationSession, compute_nav_command, locate_object
    _VLA_ENABLED = True
    logger.info("Visual navigation (Florence-2): ENABLED — torch %s", _torch.__version__)
except Exception as _vla_err:
    _VLA_ENABLED = False
    logger.warning("Visual navigation (Florence-2): DISABLED — %s", _vla_err)

# Try to import Convex client; gracefully degrade if not available
try:
    from convex_client import save_trajectory as _convex_save_trajectory
    _CONVEX_ENABLED = True
except ImportError:
    _CONVEX_ENABLED = False

# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _quat_to_yaw(q: list) -> float:
    """Extract yaw (rotation around Z) from a [w, x, y, z] quaternion."""
    w, qx, qy, qz = q[0], q[1], q[2], q[3]
    return math.atan2(2.0 * (w * qz + qx * qy), 1.0 - 2.0 * (qy * qy + qz * qz))


def _compute_validation(parsed: dict, result: dict) -> dict:
    """
    Compare commanded motion against actual execution outcome.

    Returns a dict with accuracy metrics (0-100 percentages, distances in metres,
    angles in degrees). Any field may be None when not applicable (e.g. distance
    accuracy for a pure-rotation command).
    """
    trajectory = result.get("trajectory", [])
    actual_duration = result.get("total_duration", 0.0)
    actual_distance = result.get("distance_traveled", 0.0)

    cmd_type = parsed.get("type", "single")

    if cmd_type == "sequence":
        steps = parsed.get("steps", [])
        commanded_duration = sum(s["duration"] for s in steps)
        commanded_distance = sum(
            math.sqrt(s.get("vx", 0.0) ** 2 + s.get("vy", 0.0) ** 2) * s["duration"]
            for s in steps
        )
        commanded_angle = sum(s.get("wz", 0.0) * s["duration"] for s in steps)
    else:
        commanded_duration = parsed.get("duration", 0.0)
        vx = parsed.get("vx", 0.0)
        vy = parsed.get("vy", 0.0)
        wz = parsed.get("wz", 0.0)
        commanded_distance = math.sqrt(vx ** 2 + vy ** 2) * commanded_duration
        commanded_angle = wz * commanded_duration

    # ── Duration accuracy ────────────────────────────────────────────────────
    if commanded_duration > 0:
        duration_acc = max(0.0, 1.0 - abs(commanded_duration - actual_duration) / commanded_duration)
    else:
        duration_acc = 1.0

    # ── Distance accuracy (N/A for pure rotation) ────────────────────────────
    if commanded_distance > 0.01:
        distance_acc = max(0.0, 1.0 - abs(commanded_distance - actual_distance) / commanded_distance)
    else:
        distance_acc = None

    # ── Heading drift and lateral drift (from first/last trajectory frames) ──
    heading_drift_deg = None
    lateral_drift_m = None

    if len(trajectory) >= 2:
        first_frame = trajectory[0]
        last_frame = trajectory[-1]
        first_ori = first_frame.get("base_orientation")   # [w, x, y, z]
        last_ori  = last_frame.get("base_orientation")
        first_pos = first_frame.get("base_position")      # [x, y, z]
        last_pos  = last_frame.get("base_position")

        if first_ori and last_ori and len(first_ori) == 4 and len(last_ori) == 4:
            initial_yaw = _quat_to_yaw(first_ori)
            final_yaw   = _quat_to_yaw(last_ori)
            actual_angle = final_yaw - initial_yaw
            # Wrap to [-π, π]
            actual_angle = math.atan2(math.sin(actual_angle), math.cos(actual_angle))
            drift_rad = actual_angle - commanded_angle
            drift_rad = math.atan2(math.sin(drift_rad), math.cos(drift_rad))
            heading_drift_deg = round(math.degrees(drift_rad), 2)

            # Lateral drift — only meaningful for commands with linear motion
            if first_pos and last_pos and commanded_distance > 0.01:
                dx = last_pos[0] - first_pos[0]
                dy = last_pos[1] - first_pos[1]
                # Lateral unit vector = 90° CCW from initial heading
                lat_x = -math.sin(initial_yaw)
                lat_y =  math.cos(initial_yaw)
                lateral_drift_m = round(dx * lat_x + dy * lat_y, 4)

    # ── Overall accuracy score ───────────────────────────────────────────────
    scores = [s for s in [duration_acc, distance_acc] if s is not None]
    overall_accuracy = round(sum(scores) / len(scores) * 100) if scores else None

    return {
        "overall_accuracy": overall_accuracy,
        "distance_accuracy": round(distance_acc * 100) if distance_acc is not None else None,
        "duration_accuracy": round(duration_acc * 100),
        "heading_drift_deg": heading_drift_deg,
        "lateral_drift_m": lateral_drift_m,
        "commanded_distance_m": round(commanded_distance, 3),
        "actual_distance_m": round(actual_distance, 3),
        "commanded_duration_s": round(commanded_duration, 3),
        "actual_duration_s": round(actual_duration, 3),
    }


# ---------------------------------------------------------------------------
# Graph state — only serializable primitives
# ---------------------------------------------------------------------------

class AgentState(TypedDict, total=False):
    text: str
    command_id: str
    parsed: dict | None
    confirmation_text: str
    confirmed: bool
    is_navigate: bool
    nav_result: str  # "arrived" | "not_found" | "timeout"


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class RoboScribeAgent:
    """Orchestrates the command lifecycle via a LangGraph state machine."""

    def __init__(self) -> None:
        self._graph = self._build_graph()
        # command_id → asyncio.Event
        self._pending_confirmations: dict[str, asyncio.Event] = {}
        # command_id → bool
        self._confirmation_results: dict[str, bool] = {}
        # command_id → {send_to_dashboard, send_to_sim, natural_language, parsed}
        self._run_context: dict[str, dict] = {}
        # In-memory trajectory store (until Convex is set up)
        self.trajectories: list[dict] = []
        # Active run task — cancelled when a new command arrives or emergency stop fires
        self._active_run_task: asyncio.Task | None = None

    # ------------------------------------------------------------------
    # Helpers — look up callables from instance store, not state
    # ------------------------------------------------------------------

    def _dashboard(self, command_id: str) -> Callable[[dict], Awaitable[None]]:
        return self._run_context[command_id]["send_to_dashboard"]

    def _sim(self, command_id: str) -> Callable[[dict], Awaitable[None]]:
        return self._run_context[command_id]["send_to_sim"]

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def _build_graph(self) -> Any:
        graph = StateGraph(AgentState)

        graph.add_node("parse_command", self._node_parse_command)
        graph.add_node("send_confirmation", self._node_send_confirmation)
        graph.add_node("await_confirmation", self._node_await_confirmation)
        graph.add_node("dispatch_to_sim", self._node_dispatch_to_sim)
        graph.add_node("dispatch_navigation", self._node_dispatch_navigation)
        graph.add_node("search_and_retry", self._node_search_and_retry)

        graph.set_entry_point("parse_command")
        graph.add_edge("parse_command", "send_confirmation")
        graph.add_edge("send_confirmation", "await_confirmation")

        def _route_confirmation(state: AgentState) -> str:
            if not state.get("confirmed"):
                return "reject"
            return "navigate" if state.get("is_navigate") else "dispatch"

        graph.add_conditional_edges(
            "await_confirmation",
            _route_confirmation,
            {"dispatch": "dispatch_to_sim", "navigate": "dispatch_navigation", "reject": END},
        )
        graph.add_edge("dispatch_to_sim", END)

        # After navigate attempt: if target wasn't visible, search and retry once
        graph.add_conditional_edges(
            "dispatch_navigation",
            lambda state: "search" if state.get("nav_result") == "not_found" else END,
            {"search": "search_and_retry", END: END},
        )
        graph.add_edge("search_and_retry", END)

        return graph.compile()

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def _node_parse_command(self, state: AgentState) -> AgentState:
        command_id = state["command_id"]
        text = state["text"]
        send = self._dashboard(command_id)

        logger.info("[%s] Parsing: %s", command_id, text)
        parsed, parse_diag = await parse_command_with_llm(text)

        if parsed is None:
            await send_observability_event(
                "parse_failed",
                {"command_id": command_id, **parse_diag},
            )
            await send({"type": "result_text",
                        "text": "Sorry, I couldn't understand that command. Please try again."})
            await send({"type": "status", "robot_status": "idle"})
            return {**state, "parsed": None}

        await send_observability_event(
            "command_parsed",
            {
                "command_id": command_id,
                "parsed_command": parsed,
                **parse_diag,
            },
        )

        description = parsed.get("description", "perform the requested action")
        cmd_type = parsed.get("type", "single")

        if cmd_type == "navigate":
            target = parsed.get("target", "the target")
            confirmation_text = (
                f"I will navigate to the {target}. "
                "The robot will search, turn toward the object, and walk until within 3 metres. "
                "Shall I proceed?"
            )
            return {**state, "parsed": parsed, "confirmation_text": confirmation_text, "is_navigate": True}

        if cmd_type == "sequence":
            steps = parsed.get("steps", [])
            total_duration = parsed.get("total_duration", 0.0)
            confirmation_text = (
                f"I will {description}. "
                f"This is a {len(steps)}-step sequence taking approximately {total_duration:.1f} seconds total. "
                "Shall I proceed?"
            )
        else:
            duration = parsed.get("duration", 0.0)
            confirmation_text = (
                f"I will {description}. "
                f"This will take approximately {duration:.1f} seconds. "
                "Shall I proceed?"
            )
        return {**state, "parsed": parsed, "confirmation_text": confirmation_text}

    async def _node_send_confirmation(self, state: AgentState) -> AgentState:
        if state.get("parsed") is None:
            return state

        command_id = state["command_id"]
        send = self._dashboard(command_id)

        await send({
            "type": "command_parsed",
            "command_id": command_id,
            "natural_language": state["text"],
            "parsed": state["parsed"],
            "confirmation_text": state["confirmation_text"],
        })
        await send({"type": "awaiting_confirmation", "command_id": command_id})
        return state

    async def _node_await_confirmation(self, state: AgentState) -> AgentState:
        if state.get("parsed") is None:
            return {**state, "confirmed": False}

        command_id = state["command_id"]
        send = self._dashboard(command_id)
        event = asyncio.Event()
        self._pending_confirmations[command_id] = event

        try:
            await asyncio.wait_for(event.wait(), timeout=30.0)
            confirmed = self._confirmation_results.pop(command_id, False)
        except asyncio.TimeoutError:
            logger.warning("[%s] Confirmation timeout", command_id)
            confirmed = False
            await send({"type": "result_text", "text": "Confirmation timed out. Command cancelled."})
        finally:
            self._pending_confirmations.pop(command_id, None)

        if not confirmed:
            await send({"type": "status", "robot_status": "idle"})

        return {**state, "confirmed": confirmed}

    async def _node_dispatch_to_sim(self, state: AgentState) -> AgentState:
        command_id = state["command_id"]
        parsed = state["parsed"]
        send_dashboard = self._dashboard(command_id)
        send_sim = self._sim(command_id)

        if parsed.get("type") == "sequence":
            total_duration = parsed["total_duration"]
            total_steps = int(total_duration * 200)
            sim_msg = {
                "type": "execute",
                "command_id": command_id,
                "steps": parsed["steps"],
            }
        else:
            total_duration = parsed["duration"]
            total_steps = int(total_duration * 200)
            sim_msg = {
                "type": "execute",
                "command_id": command_id,
                "vx": parsed["vx"],
                "vy": parsed["vy"],
                "wz": parsed["wz"],
                "duration": total_duration,
            }

        await send_dashboard({"type": "status", "robot_status": "executing"})
        await send_dashboard({
            "type": "execution_started",
            "command_id": command_id,
            "total_steps": total_steps,
            "total_duration": total_duration,
        })
        await send_sim(sim_msg)

        # Store natural language + parsed for receive_execution_result()
        self._run_context[command_id]["natural_language"] = state["text"]
        self._run_context[command_id]["parsed"] = parsed

        logger.info("[%s] Dispatched to sim: %s", command_id, parsed)
        return state

    async def _node_dispatch_navigation(self, state: AgentState) -> AgentState:
        """
        Await the visual navigation loop and return its outcome in state.
        LangGraph then routes: not_found → search_and_retry, otherwise END.
        """
        command_id = state["command_id"]
        parsed = state["parsed"]
        target = parsed.get("target", "target")
        send_dashboard = self._dashboard(command_id)
        send_sim = self._sim(command_id)
        get_camera_frame = self._run_context[command_id].get("get_camera_frame")

        self._run_context[command_id]["natural_language"] = state["text"]
        self._run_context[command_id]["parsed"] = parsed

        await send_dashboard({"type": "status", "robot_status": "executing"})
        await send_dashboard({"type": "navigation_started", "target": target, "command_id": command_id})

        if not _VLA_ENABLED:
            await send_dashboard({
                "type": "result_text",
                "text": (
                    "Visual navigation is unavailable — Florence-2 not installed. "
                    "Run: pip install torch transformers pillow"
                ),
            })
            await send_dashboard({"type": "status", "robot_status": "idle"})
            self._run_context.pop(command_id, None)
            return {**state, "nav_result": "not_found"}

        logger.info("[%s] Navigation loop starting for target='%s'", command_id, target)
        result = await self._run_navigation_loop(command_id, target, send_dashboard, send_sim, get_camera_frame)

        # Terminal outcomes that won't be retried: send idle here
        if result in ("arrived", "timeout"):
            await send_dashboard({"type": "status", "robot_status": "idle"})
            self._run_context.pop(command_id, None)

        return {**state, "nav_result": result}

    async def _run_navigation_loop(
        self,
        command_id: str,
        target: str,
        send_dashboard,
        send_sim,
        get_camera_frame,
    ) -> str:
        """
        ~3Hz visual navigation loop.

        Returns one of:
          "arrived"   — robot is within 1m of target
          "not_found" — target never appeared in frame (MAX_LOST_FRAMES consecutive misses)
          "timeout"   — target was visible but robot ran out of time (max 60s)

        Caller is responsible for sending status:idle.
        """
        STEP_INTERVAL = 0.35  # ~3Hz — Qwen3-VL-2B inference takes ~200ms/frame
        # 100 steps × 0.35s ≈ 35s max per navigation attempt before giving up
        session = NavigationSession(target, command_id, max_steps=100)
        loop = asyncio.get_event_loop()
        outcome = "not_found"

        while session.active:
            await asyncio.sleep(STEP_INTERVAL)

            frame = get_camera_frame() if get_camera_frame else None
            rgb_b64 = frame.get("image_rgb_b64") if frame else None
            depth_b64 = frame.get("image_depth_b64") if frame else None

            if not rgb_b64:
                logger.info("[%s] step=%d — no camera frame (lost=%d)", command_id[:8], session.step, session.lost_frames)
                should_continue = session.tick(detected=False)
                await send_dashboard({
                    "type": "navigation_progress",
                    "command_id": command_id,
                    "target": target,
                    "detected": False,
                })
                if not should_continue:
                    await send_sim({"type": "stop"})
                    outcome = "not_found"
                    break
                continue

            # Qwen2-VL in thread executor — doesn't block the event loop
            detection = await loop.run_in_executor(None, locate_object, rgb_b64, target)
            detected = detection is not None
            should_continue = session.tick(detected)

            if detected:
                nav_cmd = compute_nav_command(detection["bbox"], depth_b64)
                logger.info("[%s] step=%d — DETECTED '%s' cx=%.0f dist=%.2fm bearing=%.2f → vx=%.2f wz=%.2f",
                    command_id[:8], session.step, target,
                    detection["cx"], nav_cmd["distance"], nav_cmd["bearing"],
                    nav_cmd["vx"], nav_cmd["wz"])
                await send_sim({"type": "vla_step", "vx": nav_cmd["vx"], "wz": nav_cmd["wz"]})
                await send_dashboard({
                    "type": "navigation_progress",
                    "command_id": command_id,
                    "target": target,
                    "distance": nav_cmd["distance"],
                    "bearing": nav_cmd["bearing"],
                    "detected": True,
                })

                if nav_cmd["arrived"]:
                    await send_sim({"type": "stop"})
                    await send_dashboard({"type": "navigation_arrived", "target": target, "command_id": command_id})
                    await send_dashboard({
                        "type": "result_text",
                        "text": f"Arrived at the {target}. Navigation complete.",
                    })
                    outcome = "arrived"
                    break
            else:
                logger.info("[%s] step=%d — not detected '%s' (lost=%d/%d)",
                    command_id[:8], session.step, target,
                    session.lost_frames, session.MAX_LOST_FRAMES)
                await send_sim({"type": "vla_step", "vx": 0.0, "wz": 0.0})
                await send_dashboard({
                    "type": "navigation_progress",
                    "command_id": command_id,
                    "target": target,
                    "detected": False,
                })

            if not should_continue:
                await send_sim({"type": "stop"})
                if session.lost_frames >= session.MAX_LOST_FRAMES:
                    outcome = "not_found"
                else:
                    # Hit max_steps while target was visible → timeout
                    await send_dashboard({
                        "type": "result_text",
                        "text": f"Navigation timed out. The {target} was visible but could not be reached.",
                    })
                    outcome = "timeout"
                break

        await send_sim({"type": "stop"})
        logger.info("[%s] Navigation loop ended: %s", command_id, outcome)
        return outcome

    async def _node_search_and_retry(self, state: AgentState) -> AgentState:
        """
        Fallback when the target wasn't visible during the initial navigation attempt.

        Strategy:
          Phase 1 — rotate 360° in place, checking camera each tick for the target
          Phase 2 — if still not found, walk forward 1m then rotate 360° again
          Phase 3 — if found at any point, run a fresh navigation loop
          Give up   — if not found after both phases, report failure
        """
        command_id = state["command_id"]
        target = state["parsed"]["target"]
        send_dashboard = self._dashboard(command_id)
        send_sim = self._sim(command_id)
        get_camera_frame = self._run_context[command_id].get("get_camera_frame")

        await send_dashboard({
            "type": "result_text",
            "text": f"I can't see the {target}. Searching by rotating...",
        })
        logger.info("[%s] Search phase 1: rotation sweep for '%s'", command_id, target)

        # Phase 1: rotate 360° scanning for target
        found = await self._search_by_rotation(command_id, target, send_dashboard, send_sim, get_camera_frame)

        if not found:
            await send_dashboard({
                "type": "result_text",
                "text": f"Still can't find the {target}. Moving forward and searching again...",
            })
            logger.info("[%s] Search phase 2: walk forward + rotation sweep", command_id)

            # Phase 2: walk forward 1m then rotate again
            await self._walk_forward(send_sim, distance=1.0)
            found = await self._search_by_rotation(command_id, target, send_dashboard, send_sim, get_camera_frame)

        if found:
            logger.info("[%s] Target '%s' found during search — retrying navigation", command_id, target)
            await send_dashboard({
                "type": "result_text",
                "text": f"Found the {target}! Navigating now...",
            })
            result = await self._run_navigation_loop(command_id, target, send_dashboard, send_sim, get_camera_frame)
        else:
            logger.info("[%s] Target '%s' not found after full search", command_id, target)
            result = "not_found"

        # _run_navigation_loop already sends result_text on "arrived" and "timeout"
        if result == "not_found":
            await send_dashboard({
                "type": "result_text",
                "text": f"Could not find the {target} after a full search. Navigation failed.",
            })

        await send_dashboard({"type": "status", "robot_status": "idle"})
        self._run_context.pop(command_id, None)
        return state

    async def _search_by_rotation(
        self,
        command_id: str,
        target: str,
        send_dashboard,
        send_sim,
        get_camera_frame,
    ) -> bool:
        """
        Rotate 360° in place at 0.1 rad/s, checking each camera tick for the target.
        Stops and returns True as soon as the target is detected.
        Returns False if the full rotation completes without finding the target.

        Note: positive wz = CW (clockwise / right turn). Search sweeps clockwise.
        """
        # 2π / (0.1 rad/s × 0.2 s/tick) ≈ 315 ticks for a full 360°
        ROTATION_STEPS = 315
        loop = asyncio.get_event_loop()

        await send_dashboard({
            "type": "navigation_progress",
            "command_id": command_id,
            "target": target,
            "detected": False,
        })

        for _ in range(ROTATION_STEPS):
            await send_sim({"type": "vla_step", "vx": 0.0, "wz": 0.1})
            await asyncio.sleep(0.2)

            frame = get_camera_frame() if get_camera_frame else None
            rgb_b64 = frame.get("image_rgb_b64") if frame else None
            if rgb_b64:
                detection = await loop.run_in_executor(None, locate_object, rgb_b64, target)
                if detection:
                    await send_sim({"type": "vla_step", "vx": 0.0, "wz": 0.0})  # stop rotation
                    return True

        await send_sim({"type": "stop"})
        return False

    async def _walk_forward(self, send_sim, distance: float = 1.0, speed: float = 0.1) -> None:
        """Walk forward a fixed distance at slow speed using 5Hz vla_step cadence."""
        steps = int((distance / speed) / 0.2)  # distance/speed = duration; /0.2 = ticks
        for _ in range(steps):
            await send_sim({"type": "vla_step", "vx": speed, "wz": 0.0})
            await asyncio.sleep(0.2)
        await send_sim({"type": "stop"})
        await asyncio.sleep(0.3)  # brief settle before next action

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def stop(self, send_to_sim: Callable[[dict], Awaitable[None]]) -> None:
        """Cancel any running navigation/command and halt the robot immediately."""
        if self._active_run_task and not self._active_run_task.done():
            self._active_run_task.cancel()
            try:
                await self._active_run_task
            except (asyncio.CancelledError, Exception):
                pass
        await send_to_sim({"type": "stop"})

    async def run(
        self,
        text: str,
        send_to_dashboard: Callable[[dict], Awaitable[None]],
        send_to_sim: Callable[[dict], Awaitable[None]],
        get_camera_frame: Optional[Callable[[], Optional[dict]]] = None,
    ) -> None:
        """Entry point: called when the dashboard sends a command."""
        # Cancel any previous navigation/command still in flight
        await self.stop(send_to_sim)

        command_id = uuid.uuid4().hex[:8]
        self._run_context[command_id] = {
            "send_to_dashboard": send_to_dashboard,
            "send_to_sim": send_to_sim,
            "get_camera_frame": get_camera_frame,
        }

        async def _run():
            try:
                await self._graph.ainvoke({"text": text, "command_id": command_id})
            except asyncio.CancelledError:
                # Guarantee robot stops and UI resets when task is cancelled mid-flight
                logger.info("[%s] Run task cancelled — stopping robot", command_id)
                await send_to_sim({"type": "stop"})
                await send_to_dashboard({"type": "status", "robot_status": "idle"})
                raise
            finally:
                if "parsed" not in self._run_context.get(command_id, {}):
                    self._run_context.pop(command_id, None)

        self._active_run_task = asyncio.create_task(_run())
        await self._active_run_task

    async def receive_confirmation(self, command_id: str, confirmed: bool) -> None:
        """Called by the WebSocket handler when the dashboard sends yes/no."""
        event = self._pending_confirmations.get(command_id)
        if event is None:
            logger.warning("No pending confirmation for command_id=%s", command_id)
            return
        self._confirmation_results[command_id] = confirmed
        event.set()

    async def receive_execution_result(
        self,
        result: dict,
        send_to_dashboard: Callable[[dict], Awaitable[None]],
    ) -> None:
        """Called when Isaac Sim sends execution_complete."""
        command_id = result.get("command_id", "unknown")
        ctx = self._run_context.pop(command_id, {})

        outcome = result.get("outcome", "unknown")
        total_steps = result.get("total_steps", 0)
        duration = result.get("total_duration", 0.0)
        distance = result.get("distance_traveled", 0.0)

        trajectory_id = uuid.uuid4().hex[:12]
        timestamp = datetime.now(timezone.utc).isoformat()

        parsed = ctx.get("parsed", {})
        validation = _compute_validation(parsed, result)

        # Full per-frame data from Isaac Sim (200Hz joint + IMU recording)
        joint_names = result.get("joint_names", [])
        trajectory_frames = result.get("trajectory", [])

        metadata = {
            "trajectory_id": trajectory_id,
            "natural_language_command": ctx.get("natural_language", ""),
            "parsed_command": parsed,
            "timestamp": timestamp,
            "outcome": outcome,
            "total_steps": total_steps,
            "duration_seconds": duration,
            "distance_traveled": distance,
            "validation": validation,
            # Full 200Hz recording — joint positions/velocities + IMU per step
            "joint_names": joint_names,
            "trajectory": trajectory_frames,
        }

        # Store in memory (includes full trajectory frames for export)
        self.trajectories.append(metadata)
        logger.info("[%s] Execution complete — %d trajectories stored (%d frames): %s",
                    command_id, len(self.trajectories), len(trajectory_frames),
                    {k: v for k, v in metadata.items() if k not in ("trajectory", "joint_names")})

        parsed_summary = ""
        if isinstance(parsed, dict):
            parsed_summary = str(parsed.get("description") or parsed)[:800]

        low_accuracy_fields = {
            "command_id": command_id,
            "trajectory_id": trajectory_id,
            "timestamp": timestamp,
            "user_input": ctx.get("natural_language", ""),
            "parsed_summary": parsed_summary,
            "overall_accuracy": validation.get("overall_accuracy"),
            "distance_accuracy": validation.get("distance_accuracy"),
            "duration_accuracy": validation.get("duration_accuracy"),
            "heading_drift_deg": validation.get("heading_drift_deg"),
            "outcome": outcome,
            "commanded_distance_m": validation.get("commanded_distance_m"),
            "actual_distance_m": validation.get("actual_distance_m"),
            "commanded_duration_s": validation.get("commanded_duration_s"),
            "actual_duration_s": validation.get("actual_duration_s"),
        }
        await send_observability_event(
            "execution_complete",
            {
                "command_id": command_id,
                "trajectory_id": trajectory_id,
                "outcome": outcome,
                "natural_language_command": ctx.get("natural_language", ""),
                "parsed_command": parsed,
                "validation": validation,
            },
            low_accuracy_fields=low_accuracy_fields,
        )

        # Persist metadata-only to Convex (frames too large for 1MB document limit)
        if _CONVEX_ENABLED:
            convex_metadata = {k: v for k, v in metadata.items()
                               if k not in ("trajectory", "joint_names")}
            asyncio.create_task(_convex_save_trajectory(convex_metadata))

        await send_to_dashboard({
            "type": "trajectory_saved",
            "trajectory_id": trajectory_id,
            "metadata": metadata,
        })
        await send_to_dashboard({
            "type": "stats_update",
            "total_trajectories": len(self.trajectories),
            "success_rate": round(
                sum(1 for t in self.trajectories if t["outcome"] == "success")
                / len(self.trajectories) * 100
            ) if self.trajectories else 0,
            "total_timesteps": sum(t["total_steps"] for t in self.trajectories),
            "unique_commands": len(set(t["natural_language_command"] for t in self.trajectories)),
        })
        acc = validation.get("overall_accuracy")
        acc_str = f" Accuracy: {acc}%." if acc is not None else ""
        drift = validation.get("heading_drift_deg")
        drift_str = f" Heading drift: {drift:+.1f}°." if drift is not None else ""
        await send_to_dashboard({
            "type": "result_text",
            "text": (
                f"Command complete. The robot traveled {distance:.2f} meters "
                f"in {duration:.1f} seconds.{acc_str}{drift_str} Trajectory saved."
            ),
        })
        await send_to_dashboard({"type": "status", "robot_status": "idle"})

    def print_graph(self) -> None:
        """Print the LangGraph pipeline as a Mermaid diagram."""
        print(self._graph.get_graph().draw_mermaid())


if __name__ == "__main__":
    RoboScribeAgent().print_graph()
