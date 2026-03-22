"""
Convert RoboScribe JSON export → MCAP for Foxglove Studio.

Usage:
    # From the live backend (must be running):
    python to_mcap.py --url http://localhost:8000/export --out trajectories.mcap

    # From a saved JSON file:
    python to_mcap.py --file export.json --out trajectories.mcap

    # Specific trajectory index only:
    python to_mcap.py --file export.json --out traj0.mcap --index 0

Open the resulting .mcap in Foxglove Studio → File → Open local file.
Add panels: 3D (for TF + robot model), Plot (joint positions), Raw Messages.
"""

import argparse
import json
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Foxglove JSON schemas
# ---------------------------------------------------------------------------

_SCHEMA_FRAME_TRANSFORM = json.dumps({
    "$schema": "https://json-schema.org/draft-07/schema#",
    "title": "foxglove.FrameTransform",
    "type": "object",
    "properties": {
        "timestamp":       {"type": "object", "properties": {"sec": {"type": "integer"}, "nsec": {"type": "integer"}}},
        "parent_frame_id": {"type": "string"},
        "child_frame_id":  {"type": "string"},
        "translation":     {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}}},
        "rotation":        {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}, "w": {"type": "number"}}},
    },
})

_SCHEMA_JOINT_STATE = json.dumps({
    "$schema": "https://json-schema.org/draft-07/schema#",
    "title": "foxglove.JointState",
    "type": "object",
    "properties": {
        "timestamp":    {"type": "object", "properties": {"sec": {"type": "integer"}, "nsec": {"type": "integer"}}},
        "joint_names":  {"type": "array", "items": {"type": "string"}},
        "position":     {"type": "array", "items": {"type": "number"}},
        "velocity":     {"type": "array", "items": {"type": "number"}},
        "effort":       {"type": "array", "items": {"type": "number"}},
    },
})

_SCHEMA_IMU = json.dumps({
    "$schema": "https://json-schema.org/draft-07/schema#",
    "title": "foxglove.Imu",
    "type": "object",
    "properties": {
        "timestamp":    {"type": "object", "properties": {"sec": {"type": "integer"}, "nsec": {"type": "integer"}}},
        "frame_id":     {"type": "string"},
        "orientation":  {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}, "w": {"type": "number"}}},
        "orientation_covariance":          {"type": "array", "items": {"type": "number"}},
        "angular_velocity":                {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}}},
        "angular_velocity_covariance":     {"type": "array", "items": {"type": "number"}},
        "linear_acceleration":             {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}}},
        "linear_acceleration_covariance":  {"type": "array", "items": {"type": "number"}},
    },
})

_SCHEMA_POSE_IN_FRAME = json.dumps({
    "$schema": "https://json-schema.org/draft-07/schema#",
    "title": "foxglove.PoseInFrame",
    "type": "object",
    "properties": {
        "timestamp":  {"type": "object", "properties": {"sec": {"type": "integer"}, "nsec": {"type": "integer"}}},
        "frame_id":   {"type": "string"},
        "pose": {
            "type": "object",
            "properties": {
                "position":    {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}}},
                "orientation": {"type": "object", "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}, "w": {"type": "number"}}},
            },
        },
    },
})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_ns(t_sec: float) -> int:
    """Seconds → nanoseconds (MCAP log_time unit)."""
    return int(t_sec * 1_000_000_000)


def _ros_time(t_sec: float) -> dict:
    sec = int(t_sec)
    nsec = int((t_sec - sec) * 1_000_000_000)
    return {"sec": sec, "nsec": nsec}


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def convert(trajectories: list, out_path: Path, index: int | None = None) -> None:
    from mcap.writer import Writer

    if index is not None:
        trajectories = [trajectories[index]]

    with open(out_path, "wb") as f:
        writer = Writer(f)
        writer.start(profile="", library="roboscribe-to-mcap")

        # Register schemas
        sid_tf = writer.register_schema(
            name="foxglove.FrameTransform",
            encoding="jsonschema",
            data=_SCHEMA_FRAME_TRANSFORM.encode(),
        )
        sid_js = writer.register_schema(
            name="foxglove.JointState",
            encoding="jsonschema",
            data=_SCHEMA_JOINT_STATE.encode(),
        )
        sid_pose = writer.register_schema(
            name="foxglove.PoseInFrame",
            encoding="jsonschema",
            data=_SCHEMA_POSE_IN_FRAME.encode(),
        )
        sid_imu = writer.register_schema(
            name="foxglove.Imu",
            encoding="jsonschema",
            data=_SCHEMA_IMU.encode(),
        )

        # Register channels
        cid_tf_static = writer.register_channel(schema_id=sid_tf,   topic="/tf_static",    message_encoding="json")
        cid_tf        = writer.register_channel(schema_id=sid_tf,   topic="/tf",           message_encoding="json")
        cid_js        = writer.register_channel(schema_id=sid_js,   topic="/joint_states", message_encoding="json")
        cid_odom      = writer.register_channel(schema_id=sid_pose, topic="/odom",         message_encoding="json")
        cid_imu       = writer.register_channel(schema_id=sid_imu,  topic="/imu",          message_encoding="json")

        # Time offset so all trajectories sit on a common timeline
        wall_offset_ns = _to_ns(time.time())

        for traj_idx, traj in enumerate(trajectories):
            joint_names = traj.get("joint_names", [])
            frames = traj.get("trajectory", [])
            cmd = traj.get("natural_language_command", f"trajectory_{traj_idx}")
            print(f"  [{traj_idx}] '{cmd}' — {len(frames)} frames")

            # Offset each trajectory by its duration so they don't overlap on the timeline
            traj_start_ns = wall_offset_ns
            wall_offset_ns += _to_ns(traj.get("duration_seconds", 0.0) + 0.1)

            # Publish world → odom as a static identity transform at trajectory start.
            # This grounds "world" as the Isaac Sim global origin in Foxglove.
            # Written only to /tf_static — do NOT repeat in /tf per-frame (it never changes
            # and a stale dynamic copy in /tf can expire and break the entire TF tree).
            static_tf = {
                "timestamp":       _ros_time(traj_start_ns / 1e9),
                "parent_frame_id": "world",
                "child_frame_id":  "odom",
                "translation":     {"x": 0.0, "y": 0.0, "z": 0.0},
                "rotation":        {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            }
            writer.add_message(
                channel_id=cid_tf_static,
                log_time=traj_start_ns,
                data=json.dumps(static_tf).encode(),
                publish_time=traj_start_ns,
            )

            for frame in frames:
                t_sec = float(frame.get("t", 0.0))
                log_time = traj_start_ns + _to_ns(t_sec)
                # Message timestamps MUST match log_time so Foxglove's TF buffer can
                # look up the correct transform for the current playback position.
                ros_t = _ros_time(log_time / 1e9)

                # ── /tf — one message per transform in the TF tree ──────────
                # Always emit odom → pelvis from base_position/base_orientation
                # (guaranteed present in every frame; guards against XFormPrim failures).
                bp = frame.get("base_position", [0.0, 0.0, 0.0])
                bo = frame.get("base_orientation", [1.0, 0.0, 0.0, 0.0])  # [w,x,y,z]
                pelvis_tf = {
                    "timestamp":       ros_t,
                    "parent_frame_id": "odom",
                    "child_frame_id":  "pelvis",
                    "translation": {"x": bp[0], "y": bp[1], "z": bp[2]},
                    "rotation":    {"w": bo[0], "x": bo[1], "y": bo[2], "z": bo[3]},
                }
                writer.add_message(
                    channel_id=cid_tf,
                    log_time=log_time,
                    data=json.dumps(pelvis_tf).encode(),
                    publish_time=log_time,
                )

                for tf_entry in frame.get("tf", []):
                    child = tf_entry.get("child_frame_id")
                    if child == "pelvis":
                        continue  # already emitted above from base_position/base_orientation
                    if child == "odom":
                        continue  # world→odom is in /tf_static — never write to /tf
                    tr = tf_entry.get("transform", {})
                    msg = {
                        "timestamp":       ros_t,
                        "parent_frame_id": tf_entry["header"]["frame_id"],
                        "child_frame_id":  child,
                        "translation": tr.get("translation", {"x": 0.0, "y": 0.0, "z": 0.0}),
                        "rotation":    tr.get("rotation",    {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}),
                    }
                    writer.add_message(
                        channel_id=cid_tf,
                        log_time=log_time,
                        data=json.dumps(msg).encode(),
                        publish_time=log_time,
                    )

                # ── /joint_states ────────────────────────────────────────────
                js_msg = {
                    "timestamp":   ros_t,
                    "joint_names": joint_names,
                    "position":    frame.get("joint_positions", []),
                    "velocity":    frame.get("joint_velocities", []),
                    "effort":      [],
                }
                writer.add_message(
                    channel_id=cid_js,
                    log_time=log_time,
                    data=json.dumps(js_msg).encode(),
                    publish_time=log_time,
                )

                # ── /odom — base pose ─────────────────────────────────────
                bp = frame.get("base_position", [0.0, 0.0, 0.0])
                bo = frame.get("base_orientation", [1.0, 0.0, 0.0, 0.0])  # [w,x,y,z]
                odom_msg = {
                    "timestamp": ros_t,
                    "frame_id":  "world",
                    "pose": {
                        "position":    {"x": bp[0], "y": bp[1], "z": bp[2]},
                        "orientation": {"x": bo[1], "y": bo[2], "z": bo[3], "w": bo[0]},
                    },
                }
                writer.add_message(
                    channel_id=cid_odom,
                    log_time=log_time,
                    data=json.dumps(odom_msg).encode(),
                    publish_time=log_time,
                )

                # ── /imu — orientation + angular velocity ─────────────────
                # Note: linear_acceleration is not available from H1FlatTerrainPolicy
                # (Isaac Sim provides linear *velocity*, not accelerometer data).
                av = frame.get("linear_velocity", [0.0, 0.0, 0.0])  # unused — kept as zeros below
                wv = frame.get("angular_velocity", [0.0, 0.0, 0.0])
                imu_msg = {
                    "timestamp": ros_t,
                    "frame_id":  "pelvis",
                    "orientation": {"x": bo[1], "y": bo[2], "z": bo[3], "w": bo[0]},
                    "orientation_covariance":         [0.0] * 9,
                    "angular_velocity":               {"x": wv[0], "y": wv[1], "z": wv[2]},
                    "angular_velocity_covariance":    [0.0] * 9,
                    "linear_acceleration":            {"x": 0.0, "y": 0.0, "z": 0.0},
                    "linear_acceleration_covariance": [0.0] * 9,
                }
                writer.add_message(
                    channel_id=cid_imu,
                    log_time=log_time,
                    data=json.dumps(imu_msg).encode(),
                    publish_time=log_time,
                )

        writer.finish()
    print(f"Wrote {out_path}  ({out_path.stat().st_size // 1024} KB)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="RoboScribe JSON → MCAP converter for Foxglove")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--url",  help="Backend export URL, e.g. http://localhost:8000/export")
    src.add_argument("--file", help="Path to a saved JSON export file")
    parser.add_argument("--out",   default="trajectories.mcap", help="Output .mcap path")
    parser.add_argument("--index", type=int, default=None, help="Export only this trajectory index")
    args = parser.parse_args()

    if args.url:
        import urllib.request
        print(f"Fetching {args.url} …")
        with urllib.request.urlopen(args.url) as r:
            data = json.loads(r.read())
    else:
        with open(args.file) as f:
            data = json.load(f)

    trajectories = data.get("trajectories", data) if isinstance(data, dict) else data
    print(f"Found {len(trajectories)} trajectory/ies")

    convert(trajectories, Path(args.out), index=args.index)


if __name__ == "__main__":
    main()
