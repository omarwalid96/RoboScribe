# RoboScribe — Bridge Integration Agent Specification
**Version:** 1.0  
**Project:** RoboScribe — Natural Language Humanoid Robot Control & Data Collection Platform  
**Agent Role:** Bridge & Backend Integration Builder  
**Stack:** Python, FastAPI, WebSocket, LangGraph, LangChain, ElevenLabs, n8n, Convex  

---

## 1. Project Overview

RoboScribe bridges natural language commands from a web dashboard to a Unitree H1 humanoid robot running in NVIDIA Isaac Sim. The system interprets text commands, confirms them via ElevenLabs voice AI, executes them on the simulated humanoid, logs all joint trajectory data, and triggers n8n automation pipelines for logging and storage.

This document covers everything the bridge agent needs to build: the Isaac Sim integration, the LangGraph backend, the ElevenLabs voice loop, the WebSocket server, the n8n workflow trigger, and the Convex storage integration.

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ISAAC SIM PROCESS                            │
│                                                                     │
│   HumanoidExample (modified)                                        │
│   ├── H1FlatTerrainPolicy running at 200Hz                          │
│   ├── _base_command: [vx, vy, wz]  ← WRITE TARGET                  │
│   ├── on_physics_step() → h1.forward(step_size, _base_command)      │
│   └── RoboScribeBridge (injected)                                   │
│       ├── WebSocket client → connects to FastAPI backend            │
│       ├── Command receiver → writes to _base_command                │
│       ├── Timed executor → auto-stops after duration                │
│       └── Trajectory recorder → captures joint states every step   │
└────────────────────────┬────────────────────────────────────────────┘
                         │ WebSocket ws://localhost:8000/sim
                         │
┌────────────────────────▼────────────────────────────────────────────┐
│                     FASTAPI BACKEND (main.py)                       │
│                                                                     │
│   WebSocket Hub                                                     │
│   ├── /ws          ← Dashboard connects here                        │
│   └── /sim         ← Isaac Sim bridge connects here                 │
│                                                                     │
│   LangGraph Agent                                                   │
│   ├── Node 1: parse_command (Featherless LLM)                       │
│   ├── Node 2: speak_confirmation (ElevenLabs)                       │
│   ├── Node 3: await_confirmation (human-in-loop interrupt)          │
│   ├── Node 4: dispatch_to_sim (send to Isaac bridge)                │
│   └── Node 5: process_result (save trajectory, trigger n8n)        │
│                                                                     │
│   REST Endpoints                                                    │
│   ├── POST /command    ← receives text from dashboard WS            │
│   ├── POST /confirm    ← receives yes/no from dashboard             │
│   └── GET  /export     ← dataset export                             │
└────────────────────────┬────────────────────────────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
    ┌─────────▼──────┐    ┌────────▼────────┐
    │   n8n Webhook  │    │  Convex Database │
    │   (automation) │    │  (trajectories)  │
    └────────────────┘    └─────────────────┘
```

---

## 3. File Structure

```
roboscribe/
├── isaac_sim/
│   ├── humanoid_example_modified.py   # Modified Isaac Sim example
│   └── roboscribe_bridge.py           # Bridge injected into Isaac Sim
│
├── backend/
│   ├── main.py                        # FastAPI app + WebSocket hub
│   ├── langgraph_agent.py             # LangGraph pipeline
│   ├── command_parser.py              # LLM prompt + parsing logic
│   ├── elevenlabs_client.py           # ElevenLabs TTS integration
│   ├── convex_client.py               # Convex HTTP API client
│   ├── n8n_client.py                  # n8n webhook trigger
│   └── models.py                      # Pydantic models
│
├── .env                               # Environment variables
└── requirements.txt
```

---

## 4. Isaac Sim Bridge

### 4.1 Modified Humanoid Example

File: `isaac_sim/humanoid_example_modified.py`

Take the original `HumanoidExample` class and add the following — **do not remove any existing code**:

```python
# Add to imports:
import threading
from roboscribe_bridge import RoboScribeBridge

# Add to __init__:
self._bridge = RoboScribeBridge(
    get_command_fn=lambda: self._base_command,
    set_command_fn=self._set_base_command,
    get_robot_fn=lambda: self.h1
)

# Add new method:
def _set_base_command(self, command: list):
    self._base_command = np.array(command)

# Modify setup_post_load — add after existing code:
async def setup_post_load(self) -> None:
    # ... existing code unchanged ...
    # ADD: start bridge
    self._bridge.start()

# Modify on_physics_step — add recording call:
def on_physics_step(self, step_size) -> None:
    if self._physics_ready:
        self.h1.forward(step_size, self._base_command)
        self._bridge.record_step(step_size)  # ADD THIS LINE
    else:
        self._physics_ready = True
        self.h1.initialize()
        self.h1.post_reset()
        self.h1.robot.set_joints_default_state(self.h1.default_pos)

# Modify world_cleanup:
def world_cleanup(self):
    self._bridge.stop()  # ADD THIS LINE
    # ... existing code unchanged ...
```

### 4.2 Bridge Class

File: `isaac_sim/roboscribe_bridge.py`

```python
import asyncio
import json
import threading
import time
import websockets
import numpy as np
from dataclasses import dataclass, field
from typing import Callable, Optional

# H1 joint names in order (matches policy DOF ordering)
H1_JOINT_NAMES = [
    "left_hip_yaw", "left_hip_roll", "left_hip_pitch",
    "left_knee", "left_ankle",
    "right_hip_yaw", "right_hip_roll", "right_hip_pitch",
    "right_knee", "right_ankle",
    "torso",
    "left_shoulder_pitch", "left_shoulder_roll",
    "left_shoulder_yaw", "left_elbow",
    "right_shoulder_pitch", "right_shoulder_roll",
    "right_shoulder_yaw", "right_elbow"
]

@dataclass
class CommandExecution:
    command_id: str
    vx: float
    vy: float
    wz: float
    duration_seconds: float
    total_steps: int
    current_step: int = 0
    trajectory: list = field(default_factory=list)
    start_time: float = field(default_factory=time.time)


class RoboScribeBridge:
    """
    Bridges the Isaac Sim H1 humanoid to the RoboScribe FastAPI backend.
    
    Responsibilities:
    - Maintains WebSocket connection to backend at ws://localhost:8000/sim
    - Receives command execution requests from backend
    - Writes velocity commands to _base_command (via set_command_fn)
    - Records joint states every physics step during execution
    - Sends trajectory data back to backend on completion
    - Sends live joint updates at 20Hz to backend (throttled)
    """

    BACKEND_WS_URL = "ws://localhost:8000/sim"
    PHYSICS_DT = 1.0 / 200.0      # 200Hz physics
    JOINT_UPDATE_INTERVAL = 0.05  # Send joint updates at 20Hz

    def __init__(
        self,
        get_command_fn: Callable,
        set_command_fn: Callable,
        get_robot_fn: Callable
    ):
        self._get_command = get_command_fn
        self._set_command = set_command_fn
        self._get_robot = get_robot_fn
        
        self._current_execution: Optional[CommandExecution] = None
        self._is_recording = False
        self._step_count = 0
        self._last_joint_update_time = 0.0
        self._ws = None
        self._loop = None
        self._thread = None
        self._running = False

    def start(self):
        """Start the bridge WebSocket thread."""
        self._running = True
        self._thread = threading.Thread(target=self._run_async_loop, daemon=True)
        self._thread.start()

    def stop(self):
        """Stop the bridge."""
        self._running = False
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)

    def record_step(self, step_size: float):
        """
        Called every physics step (200Hz) from on_physics_step.
        Records joint state if actively executing a command.
        Sends throttled live updates to backend.
        """
        robot = self._get_robot()
        if robot is None:
            return

        current_time = self._step_count * self.PHYSICS_DT

        # Always send live joint updates at 20Hz
        if current_time - self._last_joint_update_time >= self.JOINT_UPDATE_INTERVAL:
            self._send_joint_update(robot, current_time)
            self._last_joint_update_time = current_time

        # Record trajectory if executing
        if self._current_execution and self._is_recording:
            exec = self._current_execution
            
            # Capture joint state
            try:
                joint_pos = robot.robot.get_joint_positions().tolist()
                joint_vel = robot.robot.get_joint_velocities().tolist()
                base_pos, base_quat = robot.robot.get_world_pose()
            except Exception:
                self._step_count += 1
                return

            step_data = {
                "step": exec.current_step,
                "t": round(current_time, 4),
                "joint_positions": joint_pos,
                "joint_velocities": joint_vel,
                "base_position": base_pos.tolist(),
                "base_orientation": base_quat.tolist(),
                "command": [exec.vx, exec.vy, exec.wz]
            }
            exec.trajectory.append(step_data)
            exec.current_step += 1

            # Send progress update every 20 steps (~0.1s)
            if exec.current_step % 20 == 0:
                self._send_progress_update(exec, base_pos)

            # Check if execution duration complete
            if exec.current_step >= exec.total_steps:
                self._complete_execution(exec, base_pos)

        self._step_count += 1

    def _complete_execution(self, exec: CommandExecution, final_base_pos):
        """Stop execution, reset command, send trajectory to backend."""
        self._set_command([0.0, 0.0, 0.0])
        self._is_recording = False
        
        # Calculate distance traveled (2D, ignoring z)
        if exec.trajectory:
            start_pos = exec.trajectory[0]["base_position"]
            end_pos = final_base_pos.tolist()
            distance = float(np.sqrt(
                (end_pos[0] - start_pos[0])**2 +
                (end_pos[1] - start_pos[1])**2
            ))
        else:
            distance = 0.0

        # Send completion + full trajectory to backend
        payload = {
            "type": "execution_complete",
            "command_id": exec.command_id,
            "outcome": "success",
            "total_steps": exec.current_step,
            "total_duration": exec.current_step * self.PHYSICS_DT,
            "distance_traveled": round(distance, 3),
            "joint_names": H1_JOINT_NAMES,
            "trajectory": exec.trajectory
        }
        
        self._async_send(payload)
        self._current_execution = None

    def _send_joint_update(self, robot, current_time: float):
        """Send current joint state to backend at 20Hz."""
        try:
            joint_pos = robot.robot.get_joint_positions().tolist()
            joint_vel = robot.robot.get_joint_velocities().tolist()
            base_pos, base_quat = robot.robot.get_world_pose()
        except Exception:
            return

        payload = {
            "type": "joint_update",
            "step": self._step_count,
            "t": round(current_time, 4),
            "joint_positions": joint_pos,
            "joint_velocities": joint_vel,
            "joint_torques": [0.0] * 19,  # H1 policy does not expose torques
            "base_position": base_pos.tolist(),
            "base_orientation": base_quat.tolist(),
            "command": self._get_command().tolist()
        }
        self._async_send(payload)

    def _send_progress_update(self, exec: CommandExecution, base_pos):
        """Send execution progress to backend every ~0.1s."""
        if exec.trajectory:
            start_pos = exec.trajectory[0]["base_position"]
            distance = float(np.sqrt(
                (base_pos[0] - start_pos[0])**2 +
                (base_pos[1] - start_pos[1])**2
            ))
        else:
            distance = 0.0

        payload = {
            "type": "execution_progress",
            "command_id": exec.command_id,
            "current_step": exec.current_step,
            "current_time": round(exec.current_step * self.PHYSICS_DT, 3),
            "distance_traveled": round(distance, 3)
        }
        self._async_send(payload)

    def _start_execution(self, msg: dict):
        """
        Called when backend sends execute command.
        Sets _base_command and starts recording.
        """
        exec = CommandExecution(
            command_id=msg["command_id"],
            vx=msg["vx"],
            vy=msg["vy"],
            wz=msg["wz"],
            duration_seconds=msg["duration"],
            total_steps=int(msg["duration"] / self.PHYSICS_DT)
        )
        self._current_execution = exec
        self._set_command([exec.vx, exec.vy, exec.wz])
        self._is_recording = True

    def _run_async_loop(self):
        """Run the asyncio event loop in background thread."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._connect_loop())

    async def _connect_loop(self):
        """Maintain WebSocket connection with auto-reconnect."""
        retry_delays = [1, 2, 4, 8, 16, 30]
        attempt = 0
        while self._running:
            try:
                async with websockets.connect(self.BACKEND_WS_URL) as ws:
                    self._ws = ws
                    attempt = 0
                    print(f"[RoboScribe Bridge] Connected to {self.BACKEND_WS_URL}")
                    await self._send_json(ws, {"type": "sim_connected"})
                    async for message in ws:
                        await self._handle_message(json.loads(message))
            except Exception as e:
                delay = retry_delays[min(attempt, len(retry_delays) - 1)]
                print(f"[RoboScribe Bridge] Disconnected ({e}). Retrying in {delay}s...")
                attempt += 1
                await asyncio.sleep(delay)
        
    async def _handle_message(self, msg: dict):
        """Handle incoming messages from backend."""
        msg_type = msg.get("type")
        if msg_type == "execute":
            self._start_execution(msg)
        elif msg_type == "stop":
            self._set_command([0.0, 0.0, 0.0])
            self._is_recording = False
            self._current_execution = None

    def _async_send(self, payload: dict):
        """Thread-safe send to WebSocket."""
        if self._loop and self._ws:
            asyncio.run_coroutine_threadsafe(
                self._send_json(self._ws, payload),
                self._loop
            )

    @staticmethod
    async def _send_json(ws, payload: dict):
        try:
            await ws.send(json.dumps(payload))
        except Exception as e:
            print(f"[RoboScribe Bridge] Send error: {e}")
```

---

## 5. FastAPI Backend

### 5.1 Models

File: `backend/models.py`

```python
from pydantic import BaseModel
from typing import Optional, List
from enum import Enum

class RobotStatus(str, Enum):
    idle = "idle"
    executing = "executing"
    error = "error"

class VoiceState(str, Enum):
    idle = "idle"
    speaking = "speaking"
    awaiting_confirmation = "awaiting_confirmation"

class ParsedCommand(BaseModel):
    vx: float
    vy: float
    wz: float
    duration: float
    description: str  # human readable: "walk forward at 0.75 m/s for 1.33 seconds"

class CommandRequest(BaseModel):
    text: str

class ConfirmationRequest(BaseModel):
    command_id: str
    confirmed: bool

class TrajectoryMetadata(BaseModel):
    trajectory_id: str
    natural_language_command: str
    parsed_command: dict
    timestamp: str
    outcome: str
    total_steps: int
    duration_seconds: float
    distance_traveled: float
```

### 5.2 Main FastAPI App

File: `backend/main.py`

```python
import asyncio
import json
import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
import io

from models import CommandRequest, ConfirmationRequest
from langgraph_agent import RoboScribeAgent

app = FastAPI(title="RoboScribe Backend")

app.add_middleware(CORSMiddleware, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"])

# Connection managers
dashboard_ws: Optional[WebSocket] = None   # One dashboard at a time
sim_ws: Optional[WebSocket] = None         # One sim bridge at a time

agent = RoboScribeAgent()


async def send_to_dashboard(payload: dict):
    """Send message to dashboard WebSocket."""
    if dashboard_ws:
        try:
            await dashboard_ws.send_json(payload)
        except Exception:
            pass


async def send_to_sim(payload: dict):
    """Send execute command to Isaac Sim bridge."""
    if sim_ws:
        try:
            await sim_ws.send_json(payload)
        except Exception:
            pass


@app.websocket("/ws")
async def dashboard_websocket(websocket: WebSocket):
    """Dashboard connection."""
    global dashboard_ws
    await websocket.accept()
    dashboard_ws = websocket
    await send_to_dashboard({"type": "status", "robot_status": "idle"})
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "command":
                # Start LangGraph pipeline in background
                asyncio.create_task(
                    agent.run(data["text"], send_to_dashboard, send_to_sim)
                )

            elif msg_type == "confirmation":
                # Route confirmation to waiting agent
                await agent.receive_confirmation(
                    data["command_id"],
                    data["confirmed"]
                )

            elif msg_type == "export_request":
                # Handled via REST endpoint instead
                pass

    except WebSocketDisconnect:
        dashboard_ws = None


@app.websocket("/sim")
async def sim_websocket(websocket: WebSocket):
    """Isaac Sim bridge connection."""
    global sim_ws
    await websocket.accept()
    sim_ws = websocket
    await send_to_dashboard({"type": "status", "robot_status": "idle"})
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            if msg_type == "joint_update":
                # Forward directly to dashboard
                await send_to_dashboard(data)

            elif msg_type == "execution_progress":
                await send_to_dashboard(data)

            elif msg_type == "execution_complete":
                # Route to agent for trajectory processing
                await agent.receive_execution_result(data, send_to_dashboard)
                await send_to_dashboard({
                    "type": "status", "robot_status": "idle"
                })

            elif msg_type == "sim_connected":
                print("[Backend] Isaac Sim bridge connected")

    except WebSocketDisconnect:
        sim_ws = None
        await send_to_dashboard({"type": "status", "robot_status": "error"})


@app.get("/export")
async def export_dataset(format: str = "json", session: str = "all"):
    """Export trajectory dataset."""
    from convex_client import ConvexClient
    convex = ConvexClient()
    trajectories = await convex.get_all_trajectories()

    if format == "json":
        data = json.dumps({
            "export_metadata": {
                "version": "1.0",
                "robot": "Unitree H1",
                "simulator": "NVIDIA Isaac Sim",
                "total_trajectories": len(trajectories)
            },
            "trajectories": trajectories
        }, indent=2)
        return StreamingResponse(
            io.StringIO(data),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=roboscribe_dataset.json"}
        )
    # CSV and ZIP formats: implement similarly
```

---

## 6. LangGraph Agent

File: `backend/langgraph_agent.py`

```python
import asyncio
import uuid
from typing import Callable, Awaitable, Optional
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage
from command_parser import parse_command_with_llm
from elevenlabs_client import ElevenLabsClient
from convex_client import ConvexClient
from n8n_client import trigger_n8n_webhook

class AgentState:
    def __init__(self):
        self.command_id: str = ""
        self.natural_language: str = ""
        self.parsed: Optional[dict] = None
        self.spoken_text: str = ""
        self.confirmed: Optional[bool] = None
        self.trajectory: Optional[dict] = None
        self.outcome: str = ""


class RoboScribeAgent:
    """
    LangGraph pipeline for processing a single command end-to-end.
    
    Flow:
    parse_command → speak_confirmation → await_confirmation
         → [confirmed] → dispatch_to_sim → process_result → END
         → [rejected] → END
    """

    def __init__(self):
        self.elevenlabs = ElevenLabsClient()
        self.convex = ConvexClient()
        # Pending confirmations: command_id → asyncio.Event
        self._pending_confirmations: dict[str, asyncio.Event] = {}
        self._confirmation_results: dict[str, bool] = {}

    async def run(
        self,
        text: str,
        send_to_dashboard: Callable,
        send_to_sim: Callable
    ):
        """Run the full pipeline for a single text command."""
        command_id = str(uuid.uuid4())[:8]

        # --- Node 1: Parse Command ---
        await send_to_dashboard({"type": "status", "robot_status": "idle"})
        parsed = await parse_command_with_llm(text)

        if parsed is None:
            await send_to_dashboard({
                "type": "voice_speaking",
                "text": "Sorry, I could not understand that command. Please try again."
            })
            await self.elevenlabs.speak(
                "Sorry, I could not understand that command. Please try again.",
                send_to_dashboard
            )
            return

        # Build spoken confirmation text
        spoken_text = (
            f"I will {parsed['description']}. "
            f"This will take approximately {parsed['duration']:.1f} seconds. "
            f"Shall I proceed?"
        )

        await send_to_dashboard({
            "type": "command_parsed",
            "command_id": command_id,
            "natural_language": text,
            "parsed": parsed,
            "spoken_text": spoken_text
        })

        # --- Node 2: Speak Confirmation via ElevenLabs ---
        await self.elevenlabs.speak(spoken_text, send_to_dashboard)

        # --- Node 3: Await Human Confirmation ---
        await send_to_dashboard({
            "type": "awaiting_confirmation",
            "command_id": command_id
        })

        confirmed = await self._wait_for_confirmation(command_id, timeout=30.0)

        if not confirmed:
            await send_to_dashboard({
                "type": "status", "robot_status": "idle"
            })
            await self.elevenlabs.speak("Command cancelled.", send_to_dashboard)
            return

        # --- Node 4: Dispatch to Isaac Sim ---
        await send_to_dashboard({
            "type": "status", "robot_status": "executing"
        })
        await send_to_dashboard({
            "type": "execution_started",
            "command_id": command_id,
            "total_steps": int(parsed["duration"] / (1.0/200.0)),
            "total_duration": parsed["duration"]
        })
        await send_to_sim({
            "type": "execute",
            "command_id": command_id,
            "vx": parsed["vx"],
            "vy": parsed["vy"],
            "wz": parsed["wz"],
            "duration": parsed["duration"]
        })

        # Store context for when result arrives
        self._pending_results = getattr(self, "_pending_results", {})
        self._pending_results[command_id] = {
            "natural_language": text,
            "parsed": parsed,
            "send_to_dashboard": send_to_dashboard
        }

    async def receive_confirmation(self, command_id: str, confirmed: bool):
        """Called when dashboard sends confirmation response."""
        if command_id in self._pending_confirmations:
            self._confirmation_results[command_id] = confirmed
            self._pending_confirmations[command_id].set()

    async def receive_execution_result(self, result: dict, send_to_dashboard: Callable):
        """
        Called when Isaac Sim bridge reports execution complete.
        Saves trajectory to Convex and triggers n8n.
        """
        command_id = result["command_id"]
        pending = getattr(self, "_pending_results", {}).get(command_id)
        if not pending:
            return

        natural_language = pending["natural_language"]
        parsed = pending["parsed"]

        # --- Node 5: Process Result ---

        # Build full trajectory document
        trajectory_doc = {
            "natural_language_command": natural_language,
            "parsed_command": parsed,
            "outcome": result["outcome"],
            "total_steps": result["total_steps"],
            "duration_seconds": result["total_duration"],
            "distance_traveled": result["distance_traveled"],
            "joint_names": result.get("joint_names", []),
            "trajectory": result.get("trajectory", [])
        }

        # Save to Convex
        trajectory_id = await self.convex.save_trajectory(trajectory_doc)

        # Trigger n8n
        await trigger_n8n_webhook({
            "trajectory_id": trajectory_id,
            "command": natural_language,
            "outcome": result["outcome"],
            "distance_traveled": result["distance_traveled"],
            "total_steps": result["total_steps"],
            "duration_seconds": result["total_duration"]
        })

        # Get updated stats
        stats = await self.convex.get_stats()

        # Notify dashboard
        await send_to_dashboard({
            "type": "trajectory_saved",
            "trajectory_id": trajectory_id,
            "metadata": {
                "command": natural_language,
                "timestamp": trajectory_doc.get("timestamp", ""),
                "steps": result["total_steps"],
                "duration": result["total_duration"],
                "outcome": result["outcome"]
            }
        })
        await send_to_dashboard({"type": "stats_update", **stats})

        # Speak result
        if result["outcome"] == "success":
            speech = (
                f"Command complete. "
                f"The robot traveled {result['distance_traveled']:.2f} meters "
                f"in {result['total_duration']:.1f} seconds. "
                f"Trajectory saved."
            )
        else:
            speech = "Command failed. Please try again."

        await self.elevenlabs.speak(speech, send_to_dashboard)

        # Cleanup
        self._pending_results.pop(command_id, None)

    async def _wait_for_confirmation(self, command_id: str, timeout: float) -> bool:
        """Wait for user to confirm or reject, with timeout."""
        event = asyncio.Event()
        self._pending_confirmations[command_id] = event
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
            return self._confirmation_results.get(command_id, False)
        except asyncio.TimeoutError:
            return False
        finally:
            self._pending_confirmations.pop(command_id, None)
            self._confirmation_results.pop(command_id, None)
```

---

## 7. Command Parser

File: `backend/command_parser.py`

Uses Featherless-hosted LLM via OpenAI-compatible API.

```python
import os
import json
import httpx

FEATHERLESS_API_KEY = os.environ["FEATHERLESS_API_KEY"]
FEATHERLESS_MODEL = "meta-llama/Llama-3.1-70B-Instruct"  # or Qwen2.5-72B-Instruct

SYSTEM_PROMPT = """You are a robot command parser for a Unitree H1 humanoid robot.
Parse natural language locomotion commands into structured velocity commands.

The robot uses a velocity-controlled locomotion policy:
- vx: forward/backward velocity (-1.0 to 1.0 m/s). Positive = forward.
- vy: lateral velocity (-1.0 to 1.0 m/s). Positive = left. (rarely used)
- wz: yaw angular velocity (-1.0 to 1.0 rad/s). Positive = counterclockwise/left turn.
- duration: how long to apply command in seconds.

Robot walking speed: 0.75 m/s forward. Turning rate: 0.75 rad/s.
Distance = speed × duration. Angle = rate × duration.

Examples:
- "walk forward 1 meter" → vx=0.75, vy=0, wz=0, duration=1.33
- "turn left 90 degrees" → vx=0, vy=0, wz=0.75, duration=2.09
- "turn right" → vx=0, vy=0, wz=-0.75, duration=1.57  (default 90°)
- "walk forward" → vx=0.75, vy=0, wz=0, duration=2.0  (default 2s if no distance)
- "walk in a circle" → vx=0.5, vy=0, wz=0.5, duration=12.57
- "stop" → vx=0, vy=0, wz=0, duration=0.1

Return ONLY valid JSON with these exact keys:
{
  "vx": float,
  "vy": float,
  "wz": float,
  "duration": float,
  "description": "human readable description of what will happen"
}

If the command cannot be interpreted as a locomotion command, return:
{"error": "reason"}
"""

async def parse_command_with_llm(text: str) -> dict | None:
    """Parse natural language command to velocity dict using Featherless LLM."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.featherless.ai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {FEATHERLESS_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": FEATHERLESS_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": text}
                ],
                "max_tokens": 200,
                "temperature": 0.1
            },
            timeout=10.0
        )
    
    content = response.json()["choices"][0]["message"]["content"].strip()
    
    # Strip markdown fences if present
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    
    try:
        parsed = json.loads(content)
        if "error" in parsed:
            return None
        return parsed
    except json.JSONDecodeError:
        return None
```

---

## 8. ElevenLabs Client

File: `backend/elevenlabs_client.py`

```python
import os
import asyncio
import httpx
from typing import Callable, Awaitable

ELEVENLABS_API_KEY = os.environ["ELEVENLABS_API_KEY"]
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")  # Rachel
ELEVENLABS_MODEL = "eleven_turbo_v2"


class ElevenLabsClient:
    """
    Handles text-to-speech via ElevenLabs API.
    
    When speaking:
    1. Sends voice_speaking message to dashboard (shows waveform)
    2. Calls ElevenLabs API to get audio
    3. Streams audio back to dashboard as base64 chunks
       OR: saves to temp file and sends URL
    4. Sends voice_done message when complete
    
    Note: For hackathon simplicity, we send the full audio as base64
    in a single message. The dashboard plays it via Web Audio API.
    """

    async def speak(self, text: str, send_to_dashboard: Callable):
        """Generate speech and send to dashboard."""
        
        # Notify dashboard speaking started
        await send_to_dashboard({
            "type": "voice_speaking",
            "text": text
        })

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
                    headers={
                        "xi-api-key": ELEVENLABS_API_KEY,
                        "Content-Type": "application/json"
                    },
                    json={
                        "text": text,
                        "model_id": ELEVENLABS_MODEL,
                        "voice_settings": {
                            "stability": 0.5,
                            "similarity_boost": 0.75
                        }
                    },
                    timeout=15.0
                )

            import base64
            audio_b64 = base64.b64encode(response.content).decode("utf-8")
            
            # Send audio to dashboard for playback
            await send_to_dashboard({
                "type": "voice_audio",
                "audio_base64": audio_b64,
                "format": "mp3"
            })

        except Exception as e:
            print(f"[ElevenLabs] Error: {e}")

        # Notify dashboard speaking done
        await send_to_dashboard({"type": "voice_done"})
```

**Dashboard-side audio playback:** The dashboard receives `voice_audio` message and plays it:
```javascript
// In dashboard useWebSocket hook:
if (msg.type === "voice_audio") {
  const audioData = atob(msg.audio_base64);
  const arrayBuffer = new ArrayBuffer(audioData.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < audioData.length; i++) view[i] = audioData.charCodeAt(i);
  const blob = new Blob([arrayBuffer], { type: "audio/mp3" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();
}
```

---

## 9. Convex Client

File: `backend/convex_client.py`

Uses Convex HTTP API. Get the deployment URL from the Convex dashboard.

```python
import os
import httpx
from datetime import datetime, timezone

CONVEX_URL = os.environ["CONVEX_URL"]  # e.g. https://your-deployment.convex.cloud


class ConvexClient:
    """HTTP client for Convex database operations."""

    async def save_trajectory(self, trajectory_doc: dict) -> str:
        """Save a complete trajectory to Convex. Returns trajectory_id."""
        trajectory_doc["timestamp"] = datetime.now(timezone.utc).isoformat()
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{CONVEX_URL}/api/mutation",
                json={
                    "path": "trajectories:save",
                    "args": {"trajectory": trajectory_doc}
                },
                timeout=10.0
            )
        return response.json().get("value", {}).get("id", "unknown")

    async def get_all_trajectories(self) -> list:
        """Fetch all trajectories for export."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{CONVEX_URL}/api/query",
                json={"path": "trajectories:getAll", "args": {}},
                timeout=30.0
            )
        return response.json().get("value", [])

    async def get_stats(self) -> dict:
        """Get aggregated dataset statistics."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{CONVEX_URL}/api/query",
                json={"path": "trajectories:getStats", "args": {}},
                timeout=5.0
            )
        return response.json().get("value", {
            "total_trajectories": 0,
            "success_rate": 0,
            "total_timesteps": 0,
            "unique_commands": 0
        })
```

**Convex schema** (`convex/schema.ts`):
```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  trajectories: defineTable({
    natural_language_command: v.string(),
    parsed_command: v.object({
      vx: v.number(), vy: v.number(), wz: v.number(), duration: v.number()
    }),
    outcome: v.string(),
    total_steps: v.number(),
    duration_seconds: v.number(),
    distance_traveled: v.number(),
    joint_names: v.array(v.string()),
    trajectory: v.array(v.any()),  // array of timestep objects
    timestamp: v.string(),
  })
});
```

---

## 10. n8n Webhook Client

File: `backend/n8n_client.py`

```python
import os
import httpx

N8N_WEBHOOK_URL = os.environ["N8N_WEBHOOK_URL"]


async def trigger_n8n_webhook(payload: dict):
    """
    Trigger n8n automation on trajectory completion.
    
    n8n workflow should:
    1. Receive webhook with trajectory metadata
    2. Log to a Google Sheet or Notion database (for human review)
    3. Send Slack/Discord notification if success_rate drops below threshold
    4. Optionally: trigger dataset export every N trajectories
    """
    try:
        async with httpx.AsyncClient() as client:
            await client.post(
                N8N_WEBHOOK_URL,
                json=payload,
                timeout=5.0
            )
    except Exception as e:
        print(f"[n8n] Webhook failed (non-critical): {e}")
```

**n8n Workflow to configure in n8n UI:**
- Trigger: Webhook (POST)
- Node 1: Set — extract fields from payload
- Node 2: Google Sheets append row (trajectory_id, command, outcome, distance, steps, timestamp)
- Node 3: IF — check if this is the 10th trajectory
- Node 4 (if yes): HTTP Request to `/export?format=json` → save file

---

## 11. Environment Variables

File: `.env`

```env
# Featherless LLM
FEATHERLESS_API_KEY=your_key_here
FEATHERLESS_MODEL=meta-llama/Llama-3.1-70B-Instruct

# ElevenLabs
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM

# Convex
CONVEX_URL=https://your-deployment.convex.cloud

# n8n
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/roboscribe
```

---

## 12. Requirements

File: `requirements.txt`

```
fastapi>=0.110.0
uvicorn>=0.27.0
websockets>=12.0
httpx>=0.27.0
python-dotenv>=1.0.0
langchain>=0.2.0
langgraph>=0.1.0
langchain-openai>=0.1.0
pydantic>=2.0.0
numpy>=1.24.0
```

---

## 13. Run Instructions

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Set environment variables
cp .env.example .env
# Edit .env with your API keys

# 3. Start backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 4. Start Isaac Sim with modified humanoid example
# (Open Isaac Sim → Robotics Examples → Policy → Humanoid)
# The bridge auto-connects to ws://localhost:8000/sim

# 5. Open dashboard at http://localhost:5173 (or Vercel URL)
```

---

## 14. Message Flow Summary

Complete message sequence for one command execution:

```
User types "walk forward 1 meter"
  → Dashboard sends: { type: "command", text: "walk forward 1 meter" }
  → Backend: LangGraph starts
  → Backend parses with LLM → { vx: 0.75, vy: 0, wz: 0, duration: 1.33 }
  → Backend → Dashboard: { type: "command_parsed", ... }
  → Backend: ElevenLabs generates audio
  → Backend → Dashboard: { type: "voice_speaking", text: "..." }
  → Backend → Dashboard: { type: "voice_audio", audio_base64: "..." }
  → Dashboard: plays audio
  → Backend → Dashboard: { type: "voice_done" }
  → Backend → Dashboard: { type: "awaiting_confirmation", command_id: "abc" }
  → Dashboard shows YES/NO buttons
  → User clicks YES
  → Dashboard → Backend: { type: "confirmation", command_id: "abc", confirmed: true }
  → Backend: LangGraph resumes
  → Backend → Dashboard: { type: "status", robot_status: "executing" }
  → Backend → Dashboard: { type: "execution_started", ... }
  → Backend → Isaac Sim: { type: "execute", vx: 0.75, ..., duration: 1.33 }
  → Isaac Sim: sets _base_command, starts recording
  → Isaac Sim → Backend (every 50ms): { type: "joint_update", ... }
  → Backend → Dashboard: { type: "joint_update", ... }  (forwarded)
  → Isaac Sim → Backend (every 100ms): { type: "execution_progress", ... }
  → Backend → Dashboard: { type: "execution_progress", ... }  (forwarded)
  → Isaac Sim: 266 steps complete → resets command to [0,0,0]
  → Isaac Sim → Backend: { type: "execution_complete", trajectory: [...266 steps...] }
  → Backend: saves to Convex → triggers n8n
  → Backend → Dashboard: { type: "trajectory_saved", ... }
  → Backend → Dashboard: { type: "stats_update", ... }
  → Backend: ElevenLabs speaks result
  → Backend → Dashboard: { type: "voice_audio", ... }
  → Dashboard: plays "Command complete. Robot traveled 0.98 meters."
```
