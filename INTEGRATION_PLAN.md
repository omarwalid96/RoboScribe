# RoboScribe Integration Plan

## Context
RoboScribe bridges natural language commands from a web dashboard to a Unitree H1 humanoid robot in NVIDIA Isaac Sim. The system interprets text commands, confirms via ElevenLabs voice, executes on the simulated H1, records joint trajectory data, and saves to Convex DB + triggers n8n automation.

The spec is fully defined in `roboscribe_bridge_agent.md`. This plan organizes the implementation into phases, splits work between agents, and provides actionable build order.

**Key design decision:** Build the Isaac Sim side as a **self-contained extension** (like the existing openarm ext) rather than modifying the installed HumanoidExample. This is portable, clean, and matches the user's existing workflow.

---

## Ownership Split

### WE Build (Bridge Agent)
1. **Isaac Sim Extension** (`exts/roboscribe.h1.bridge/`) — H1 robot + WebSocket bridge
2. **FastAPI Backend** (`backend/`) — WebSocket hub, LangGraph agent, all service clients

### Delegated (instructions to another agent / manual)
3. **Frontend Dashboard** — Next.js/React web UI (another agent)
4. **Convex Schema + Functions** — DB setup (another agent or manual, spec section 9 has schema)
5. **n8n Workflow** — manual configuration in n8n UI (spec section 10 has steps)

---

## Phase 1: Isaac Sim Extension (no external dependencies)

### File Structure
```
exts/roboscribe.h1.bridge/
├── config/extension.toml
├── docs/CHANGELOG.md
└── roboscribe_h1_bridge_python/
    ├── __init__.py
    ├── extension.py          # Copy openarm pattern exactly
    ├── global_variables.py   # EXTENSION_TITLE, EXTENSION_DESCRIPTION
    ├── ui_builder.py         # Load/Reset/Run + bridge status label
    ├── scenario.py           # H1 setup + keyboard + bridge integration
    └── roboscribe_bridge.py  # WebSocket bridge client (from spec 4.2)
```

### Build Order
1. `global_variables.py` — trivial constants
2. `roboscribe_bridge.py` — standalone WebSocket client from spec section 4.2, make `BACKEND_WS_URL` configurable
3. `scenario.py` — port H1 logic from `humanoid_example.py` into extension-compatible class:
   - `load_example_assets()` → ground plane + H1FlatTerrainPolicy
   - `setup()` → init robot, start bridge, register keyboard
   - `update(step)` → `h1.forward()` + `bridge.record_step()`
   - `reset()` / `cleanup()`
   - Preserve keyboard control alongside bridge commands
4. `ui_builder.py` — mirror openarm pattern, physics_dt=1/200, rendering_dt=8/200, add status indicator
5. `extension.py` — direct copy of openarm `extension.py` with import changes
6. `config/extension.toml` — deps: `isaacsim.robot.policy.examples`, `isaacsim.gui.components`, `isaacsim.core.*`, `isaacsim.examples.extension`, `isaacsim.storage.native`

### Key Source Files to Replicate From
- Extension pattern: `/home/omar/openarm_isaac_lab/exts/openarm.rmpflow.bimanual/openarm_rmpflow_bimanual_python/extension.py`
- UI pattern: `.../ui_builder.py` (same dir)
- H1 robot logic: `/home/omar/anaconda3/envs/isaaclab/lib/python3.11/site-packages/isaacsim/exts/isaacsim.examples.interactive/isaacsim/examples/interactive/humanoid/humanoid_example.py`
- Bridge code: spec section 4.2 (lines 139-413 of `roboscribe_bridge_agent.md`)

### Test
```bash
conda activate isaaclab
isaacsim --ext-folder /home/omar/Cursor_Hackathon/Roboscribe/exts --enable roboscribe.h1.bridge
```
Expect: extension in menu, Load spawns H1, keyboard works, bridge logs "Disconnected, retrying..."

---

## Phase 2: FastAPI Backend (parallel with Phase 1)

### File Structure
```
backend/
├── main.py               # FastAPI + WebSocket hub (/ws, /sim, /export)
├── langgraph_agent.py    # 4-node LangGraph pipeline (no TTS — frontend handles ElevenLabs)
├── command_parser.py     # Featherless LLM parsing
├── convex_client.py      # Convex HTTP client
├── n8n_client.py         # n8n webhook
└── models.py             # Pydantic models
```

**Note:** ElevenLabs TTS lives in the **frontend**, not the backend. The backend sends confirmation text to the dashboard, and the frontend calls ElevenLabs directly and plays audio in the browser. This avoids routing audio bytes through the backend.

### Build Order
1. `models.py` — Pydantic models (spec section 5.1)
2. `command_parser.py` — Featherless LLM integration (spec section 7)
3. `convex_client.py` — Convex HTTP client (spec section 9), **graceful no-op if CONVEX_URL unset**
4. `n8n_client.py` — webhook trigger (spec section 10), **already handles failure gracefully**
5. `langgraph_agent.py` — orchestrator (spec section 6, minus ElevenLabs calls — just send text via WS)
6. `main.py` — FastAPI app (spec section 5.2)

### Graceful Degradation (important for hackathon)
- No `FEATHERLESS_API_KEY` → fallback regex parser for basic commands
- No `CONVEX_URL` → store trajectories in-memory, still support `/export`
- No `N8N_WEBHOOK_URL` → skip silently (already handled)

### Test
```bash
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
# Test with: websocat ws://localhost:8000/sim
```

---

## Phase 3: Integration Testing

1. Start backend (terminal 1)
2. Start Isaac Sim with extension (terminal 2)
3. Verify WebSocket handshake: `[RoboScribe Bridge] Connected to ws://localhost:8000/sim`
4. Mock dashboard via websocat on `ws://localhost:8000/ws`:
   - Send: `{"type": "command", "text": "walk forward 1 meter"}`
   - Verify LLM parsing → voice confirmation → dispatch → robot moves → trajectory captured

---

## Phase 4: Instructions for Other Agents

### Frontend Agent Instructions
> Build a Next.js dashboard that connects to `ws://localhost:8000/ws`. Handle these message types:
> - Send: `{type: "command", text: "..."}` and `{type: "confirmation", command_id, confirmed}`
> - Receive: `command_parsed`, `confirmation_text` (text to speak), `awaiting_confirmation` (show YES/NO), `execution_started`, `execution_progress`, `joint_update`, `trajectory_saved`, `stats_update`, `status`
> - **ElevenLabs TTS** lives in the frontend — when receiving `confirmation_text` or result text, call ElevenLabs API directly from the browser and play audio via Web Audio API
> - See full message flow in spec section 14

### Convex Agent Instructions
> Create schema from spec section 9 (`convex/schema.ts`). Implement mutations: `trajectories:save`. Queries: `trajectories:getAll`, `trajectories:getStats`.

### n8n (Manual)
> Create workflow in n8n UI: Webhook trigger → extract fields → Google Sheets append → conditional auto-export every 10 trajectories.

---

---

## Phase 5: VLA-Ready Architecture (Design — No Implementation Required)

> **2.5 from ACTION_PLAN.md** — Document how a Vision-Language-Action model integrates without building it.

### What Changes and What Stays the Same

Everything built so far (multi-step sequences, trajectory recording at 200Hz, validation metrics, IMU-equivalent data) is **directly reusable** as VLA infrastructure. The trajectory frames already store `(joint_positions, joint_velocities, base_position, base_orientation, linear_velocity, angular_velocity, command)` per step — that is the `(observation, action)` pair a VLA model trains on. The only missing modality is camera frames.

---

### New Components

#### 1. Isaac Sim Camera Stream (`roboscribe_bridge.py`)

The bridge already runs a physics-step callback at 200Hz and sends `joint_update` at 20Hz. Add a `camera_update` alongside it:

```
New WS message (sim → backend, ~10Hz):
{
  "type": "camera_update",
  "step": 1234,
  "t": 6.17,
  "rgb": "<base64 JPEG, 320×240>",       # front-facing camera
  "depth": "<base64 float16 array>",      # optional
  "camera_pose": [x, y, z, w, qx, qy, qz]
}
```

Isaac Sim renders via `omni.replicator` or `omni.isaac.sensor.Camera`. The bridge captures the render output each N physics steps and sends it as a separate WS message — decoupled from joint data so joint recording stays at 200Hz even if camera is 10Hz.

#### 2. VLA Service (`/vla` WebSocket endpoint in `backend/main.py`)

A new WS endpoint that a VLA inference service connects to — parallel to the existing `/sim` endpoint:

```
/ws   ← Dashboard (human operator)
/sim  ← Isaac Sim bridge (robot state + execution)
/vla  ← VLA service (perception-action loop)   ← NEW
```

The VLA service is an external process (Python, runs the model). It connects to `/vla` and participates in the same message routing:

```
VLA service → backend /vla:
  {"type": "vla_connected"}
  {"type": "vla_action", "command_id": "...", "vx": 0.4, "vy": 0.0, "wz": 0.2, "confidence": 0.91}
  {"type": "vla_goal_complete", "command_id": "..."}

backend /vla → VLA service:
  {"type": "vla_goal", "command_id": "...", "text": "go to the desk", "goal_image": "<base64>"}
  {"type": "camera_update", ...}   # forwarded from /sim at 10Hz
  {"type": "stop"}                 # forwarded from dashboard emergency stop
```

#### 3. Fast-Path Dispatch (bypass LangGraph confirmation)

The existing LangGraph pipeline: `parse → confirm → await_confirmation → dispatch → END`

This is 1-2s end-to-end — too slow for a closed-loop VLA controller. VLA actions must be dispatched immediately without LLM parsing or user confirmation:

```
Existing path (human commands):
  Dashboard /ws → LangGraph (parse + confirm) → /sim execute

New VLA fast path:
  VLA service /vla → validate(vx, vy, wz bounds) → /sim execute immediately
```

The safety layer replaces the confirmation step: clamp all VLA outputs to `[-1.0, 1.0]` and reject any action with `confidence < threshold` (configurable, default 0.7).

---

### Data Flow Diagram

```
┌─────────────────┐    text goal     ┌──────────────────────────────────────────┐
│   Dashboard     │ ───────────────→ │              FastAPI Backend              │
│   /ws           │ ←─────────────── │                                          │
│  (human ops)    │  status/results  │  ┌─────────────────────────────────────┐ │
└─────────────────┘                  │  │  LangGraph (human command path)     │ │
                                     │  │  parse → confirm → dispatch          │ │
┌─────────────────┐   camera+joints  │  └──────────────────┬──────────────────┘ │
│  Isaac Sim      │ ───────────────→ │                     │ execute             │
│  Bridge /sim    │ ←─────────────── │  ┌──────────────────▼──────────────────┐ │
│  (robot state)  │  execute/stop    │  │  Sim Router: forward to /sim        │ │
└─────────────────┘                  │  └──────────────────▲──────────────────┘ │
                                     │                     │ vla_action          │
┌─────────────────┐   vla_action     │  ┌──────────────────┴──────────────────┐ │
│  VLA Service    │ ───────────────→ │  │  VLA Fast Path: clamp + validate    │ │
│  /vla           │ ←─────────────── │  └─────────────────────────────────────┘ │
│  (model loop)   │  camera_update   │                                          │
└─────────────────┘                  └──────────────────────────────────────────┘
```

---

### VLA Perception-Action Loop

The VLA service runs its own async loop at ~10Hz (matched to camera update rate):

```python
# Pseudocode — VLA service process (external, not in this repo)
async for camera_msg in vla_ws:
    if camera_msg["type"] == "camera_update":
        obs = {
            "rgb": decode_base64(camera_msg["rgb"]),
            "joint_positions": latest_joint_state["joint_positions"],
            "goal_text": current_goal,
        }
        action = vla_model.predict(obs)   # → {vx, vy, wz, confidence, done}

        if action["done"] or action["confidence"] < 0.7:
            await ws.send({"type": "vla_goal_complete", "command_id": cmd_id})
        else:
            await ws.send({"type": "vla_action",
                           "command_id": cmd_id,
                           "vx": action["vx"],
                           "vy": action["vy"],
                           "wz": action["wz"],
                           "confidence": action["confidence"]})
```

Each `vla_action` triggers one physics step's worth of execution in the bridge (dt=1/200s), or the bridge holds the last VLA command for a fixed window (e.g., 50ms) before expecting the next one.

---

### Training Data Format

The trajectory frames already collected by RoboScribe are the exact format needed for VLA training:

```json
{
  "command": "go to the red box",
  "joint_names": ["left_hip_yaw", ...],
  "trajectory": [
    {
      "t": 0.005,
      "rgb": "<base64>",                         ← add camera here
      "joint_positions": [0.01, -0.02, ...],     ← observation
      "joint_velocities": [...],                 ← observation
      "base_position": [0.0, 0.0, 1.05],        ← observation
      "linear_velocity": [0.74, 0.01, 0.0],     ← observation (IMU-equiv)
      "angular_velocity": [0.0, 0.0, 0.02],     ← observation (IMU-equiv)
      "command": [0.75, 0.0, 0.0]               ← action label
    },
    ...
  ],
  "validation": { "overall_accuracy": 94, ... }  ← trajectory quality filter
}
```

The `validation.overall_accuracy` field already computed by 2.3 serves as a **trajectory quality filter** — only include frames from trajectories with `overall_accuracy >= 85%` in the training set.

---

### What Needs to Be Built (Future Work)

| Component | Effort | Depends On |
|---|---|---|
| Camera stream in bridge (`camera_update` msg) | Medium | `omni.replicator` API |
| `/vla` WebSocket endpoint in `main.py` | Small | Existing WS pattern |
| VLA fast-path dispatch (bypass LangGraph) | Small | `main.py` routing |
| VLA service process (model + loop) | Large | Model selection (OpenVLA, RT-2, etc.) |
| Associate camera frames with trajectory frames | Medium | Camera stream + bridge sync |

The backend WS routing pattern, trajectory data schema, and validation metrics are **already production-ready** for VLA integration. Only the camera stream and the VLA service itself remain.

---

## Parallelism Map
```
Phase 1 (Isaac Sim Extension) ─────┐
                                     ├─── Phase 3 (Integration)
Phase 2 (FastAPI Backend)     ─────┘

Delegated (anytime, no blocking):
  └── Frontend / Convex / n8n
```

---

## Run Command (final)
```bash
# Terminal 1: Backend
cd /home/omar/Cursor_Hackathon/Roboscribe/backend
uvicorn main:app --host 0.0.0.0 --port 8000

# Terminal 2: Isaac Sim
conda activate isaaclab && isaacsim --ext-folder /home/omar/Cursor_Hackathon/Roboscribe/exts --enable roboscribe.h1.bridge

# Terminal 3: Dashboard (once built)
cd dashboard && npm run dev
```
