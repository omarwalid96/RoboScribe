"""FastAPI WebSocket hub for RoboScribe."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from langgraph_agent import RoboScribeAgent

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(name)s | %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App + agent
# ---------------------------------------------------------------------------

agent = RoboScribeAgent()

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("RoboScribe backend starting…")
    yield
    logger.info("RoboScribe backend shutting down.")

app = FastAPI(title="RoboScribe Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global WebSocket references
dashboard_ws: WebSocket | None = None
sim_ws: WebSocket | None = None

# Latest camera frame from Isaac Sim (set by ws_sim, read by navigation loop)
latest_camera_frame: dict | None = None


def get_latest_camera_frame() -> dict | None:
    return latest_camera_frame

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def send_to_dashboard(payload: dict) -> None:
    if dashboard_ws is not None:
        try:
            await dashboard_ws.send_json(payload)
        except Exception as exc:
            logger.warning("Failed to send to dashboard: %s", exc)


async def send_to_sim(payload: dict) -> None:
    if sim_ws is not None:
        try:
            await sim_ws.send_json(payload)
        except Exception as exc:
            logger.warning("Failed to send to sim: %s", exc)

# ---------------------------------------------------------------------------
# WebSocket: /ws — Dashboard
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def ws_dashboard(websocket: WebSocket):
    global dashboard_ws
    await websocket.accept()
    dashboard_ws = websocket
    logger.info("Dashboard connected")

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type")

            if msg_type == "command":
                text = msg.get("text", "").strip()
                if text:
                    asyncio.create_task(
                        agent.run(text, send_to_dashboard, send_to_sim, get_latest_camera_frame)
                    )

            elif msg_type == "confirmation":
                command_id = msg.get("command_id", "")
                confirmed = bool(msg.get("confirmed", False))
                await agent.receive_confirmation(command_id, confirmed)

            elif msg_type == "stop":
                # Emergency stop: cancel active navigation and halt robot immediately
                await agent.stop(send_to_sim)
                await send_to_dashboard({"type": "status", "robot_status": "idle"})

            else:
                logger.warning("Unknown message from dashboard: %s", msg)

    except WebSocketDisconnect:
        logger.info("Dashboard disconnected")
    finally:
        dashboard_ws = None

# ---------------------------------------------------------------------------
# WebSocket: /sim — Isaac Sim bridge
# ---------------------------------------------------------------------------

@app.websocket("/sim")
async def ws_sim(websocket: WebSocket):
    global sim_ws
    await websocket.accept()
    sim_ws = websocket
    logger.info("Isaac Sim bridge connected")

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type")

            if msg_type == "sim_connected":
                logger.info("Sim reported ready")

            elif msg_type == "joint_update":
                await send_to_dashboard(msg)

            elif msg_type == "camera_update":
                global latest_camera_frame
                latest_camera_frame = msg
                has_rgb = "image_rgb_b64" in msg
                has_depth = "image_depth_b64" in msg
                logger.debug("camera_update received — rgb=%s depth=%s", has_rgb, has_depth)
                # Optionally forward to dashboard (commented — large payloads)
                # await send_to_dashboard(msg)

            elif msg_type == "execution_progress":
                await send_to_dashboard(msg)

            elif msg_type == "execution_complete":
                await agent.receive_execution_result(msg, send_to_dashboard)

            else:
                logger.warning("Unknown message from sim: %s", msg_type)

    except WebSocketDisconnect:
        logger.info("Isaac Sim bridge disconnected")
        await send_to_dashboard({"type": "status", "robot_status": "error"})
    finally:
        sim_ws = None

# ---------------------------------------------------------------------------
# WebSocket: /vla — External VLA clients (fast-path, no LangGraph)
# ---------------------------------------------------------------------------

@app.websocket("/vla")
async def ws_vla(websocket: WebSocket):
    """
    Fast-path WebSocket for external VLA / navigation clients.
    Accepts vla_action messages, validates velocity bounds, and forwards
    directly to Isaac Sim as vla_step commands (no LangGraph, no confirmation).
    """
    await websocket.accept()
    logger.info("VLA client connected")
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "vla_action":
                vx = max(0.0, min(0.75, float(msg.get("vx", 0.0))))
                wz = max(-0.75, min(0.75, float(msg.get("wz", 0.0))))
                await send_to_sim({"type": "vla_step", "vx": vx, "wz": wz})
            else:
                logger.warning("Unknown VLA message: %s", msg.get("type"))
    except WebSocketDisconnect:
        logger.info("VLA client disconnected")

# ---------------------------------------------------------------------------
# REST: /export
# ---------------------------------------------------------------------------

@app.get("/export")
async def export_trajectories(format: str = "json"):
    """Export all stored trajectories. format=json|csv|hdf5"""
    if format == "hdf5":
        return _export_hdf5()

    return JSONResponse(content={
        "export_metadata": {
            "version": "1.0",
            "robot": "Unitree H1",
            "simulator": "NVIDIA Isaac Sim",
            "total_trajectories": len(agent.trajectories),
        },
        "trajectories": agent.trajectories,
    })


def _export_hdf5() -> StreamingResponse:
    import io
    import numpy as np
    import h5py

    buf = io.BytesIO()
    with h5py.File(buf, "w") as f:
        # Root metadata
        meta = f.create_group("metadata")
        meta.attrs["version"] = "1.0"
        meta.attrs["robot"] = "Unitree H1"
        meta.attrs["simulator"] = "NVIDIA Isaac Sim"
        meta.attrs["total_trajectories"] = len(agent.trajectories)

        traj_group = f.create_group("trajectories")

        for i, traj in enumerate(agent.trajectories):
            g = traj_group.create_group(str(i))

            # Scalar metadata as group attributes
            g.attrs["trajectory_id"]           = traj.get("trajectory_id", "")
            g.attrs["natural_language_command"] = traj.get("natural_language_command", "")
            g.attrs["timestamp"]               = traj.get("timestamp", "")
            g.attrs["outcome"]                 = traj.get("outcome", "unknown")
            g.attrs["total_steps"]             = int(traj.get("total_steps", 0))
            g.attrs["duration_seconds"]        = float(traj.get("duration_seconds", 0.0))
            g.attrs["distance_traveled"]       = float(traj.get("distance_traveled", 0.0))

            # Joint names
            joint_names = traj.get("joint_names", [])
            if joint_names:
                g.create_dataset("joint_names",
                                 data=np.array(joint_names, dtype=h5py.string_dtype()))

            # Link names (TF tree)
            link_names = traj.get("link_names", [])
            if link_names:
                g.create_dataset("link_names",
                                 data=np.array(link_names, dtype=h5py.string_dtype()))

            # Validation metrics as a sub-group
            val = traj.get("validation") or {}
            if val:
                vg = g.create_group("validation")
                for k, v in val.items():
                    vg.attrs[k] = v

            # Per-frame trajectory data — shaped arrays
            frames = traj.get("trajectory", [])
            if frames:
                def _stack(key, width):
                    rows = [f.get(key) or ([0.0] * width) for f in frames]
                    return np.array(rows, dtype=np.float32)

                fg = g.create_group("frames")
                fg.create_dataset("timestamps",
                                  data=np.array([fr.get("t", 0.0) for fr in frames],
                                               dtype=np.float32))
                fg.create_dataset("joint_positions",  data=_stack("joint_positions", 19))
                fg.create_dataset("joint_velocities", data=_stack("joint_velocities", 19))
                fg.create_dataset("base_position",    data=_stack("base_position", 3))
                fg.create_dataset("base_orientation", data=_stack("base_orientation", 4))
                fg.create_dataset("linear_velocity",  data=_stack("linear_velocity", 3))
                fg.create_dataset("angular_velocity", data=_stack("angular_velocity", 3))
                fg.create_dataset("commands",         data=_stack("command", 3))

                # TF tree — ROS2 TransformStamped format.
                # Stored as one sub-group per link: translation [F,3], rotation [F,4].
                # Each group has a "parent_frame" attribute matching frame_id.
                if link_names and frames and frames[0].get("tf"):
                    tf_group = fg.create_group("tf")
                    # Build per-link arrays across all frames
                    link_translations = {ln: [] for ln in link_names}
                    link_rotations    = {ln: [] for ln in link_names}
                    link_parents      = {}
                    for fr in frames:
                        tf_map = {entry["child_frame_id"]: entry for entry in fr.get("tf", [])}
                        for ln in link_names:
                            if ln in tf_map:
                                t = tf_map[ln]["transform"]["translation"]
                                r = tf_map[ln]["transform"]["rotation"]
                                link_translations[ln].append([t["x"], t["y"], t["z"]])
                                link_rotations[ln].append([r["w"], r["x"], r["y"], r["z"]])
                                link_parents[ln] = tf_map[ln]["header"]["frame_id"]
                            else:
                                link_translations[ln].append([0.0, 0.0, 0.0])
                                link_rotations[ln].append([1.0, 0.0, 0.0, 0.0])
                    for ln in link_names:
                        lg = tf_group.create_group(ln)
                        lg.attrs["parent_frame"] = link_parents.get(ln, "unknown")
                        lg.create_dataset("translation",
                                          data=np.array(link_translations[ln], dtype=np.float32))
                        lg.create_dataset("rotation",
                                          data=np.array(link_rotations[ln], dtype=np.float32))

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/x-hdf5",
        headers={"Content-Disposition": "attachment; filename=roboscribe-trajectories.h5"},
    )
