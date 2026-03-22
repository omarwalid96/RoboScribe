"""
RoboScribeH1Scenario

Manages the Unitree H1 humanoid robot in Isaac Sim.
Follows the same interface used by OpenArm extension scenarios:
  - load_example_assets() → returns list of objects to add to World scene
  - setup()               → post-load init, starts bridge, registers keyboard
  - update(step)          → called every physics step
  - reset()               → called on Reset button
  - cleanup()             → called on extension shutdown

Camera capture uses omni.kit.viewport.utility.capture_viewport_to_buffer —
the only reliable capture path in Isaac Sim 5.1 (SyntheticData/LdrColorSD
pipeline is broken for non-viewport render products in this version).
The viewport camera is switched to the robot camera on setup so the captured
frames are from the robot's perspective.
"""

import ctypes

import carb
import numpy as np
import omni.appwindow
import omni.kit.viewport.utility as vpu
import omni.replicator.core as rep

# Silence benign warnings that flood the console
carb.settings.get_settings().set_string("/log/levelFilter/omni.syntheticdata.plugin", "error")
carb.settings.get_settings().set_string("/log/levelFilter/isaacsim.core.simulation_manager.plugin", "error")
carb.settings.get_settings().set_string("/log/levelFilter/rtx.postprocessing.plugin", "error")
carb.settings.get_settings().set_string("/log/levelFilter/omni.replicator.core", "fatal")

from isaacsim.core.utils.prims import define_prim

from .roboscribe_bridge import RoboScribeBridge

ROBOT_CAM_PATH = "/World/H1/d435_rgb_module_link/Camera"
CAPTURE_INTERVAL = 40   # physics steps between captures (~5Hz at 200Hz physics)


class RoboScribeH1Scenario:
    def __init__(self):
        self._h1 = None
        self._bridge = None
        self._physics_ready = False
        self._base_command = np.array([0.0, 0.0, 0.0])
        self._sub_keyboard = None
        self._input = None
        self._keyboard = None

        self._input_keyboard_mapping = {
            "NUMPAD_8": np.array([0.75, 0.0, 0.0]),
            "UP":       np.array([0.75, 0.0, 0.0]),
            "NUMPAD_4": np.array([0.0, 0.0,  0.75]),
            "LEFT":     np.array([0.0, 0.0,  0.75]),
            "NUMPAD_6": np.array([0.0, 0.0, -0.75]),
            "RIGHT":    np.array([0.0, 0.0, -0.75]),
        }

        self._vp = None
        self._latest_frame = None       # numpy RGB (H,W,3) — written by capture callback
        self._capture_pending = False   # prevents overlapping capture requests
        self._warm_up = 0
        self._camera_logged_ready = False

    # ─── Scene loading ──────────────────────────────────────────────────────

    def load_example_assets(self):
        from isaacsim.core.api.world import World
        from isaacsim.robot.policy.examples.robots.h1 import H1FlatTerrainPolicy
        from isaacsim.storage.native import get_assets_root_path

        World.instance()
        assets_root_path = get_assets_root_path()

        from isaacsim.core.utils.stage import add_reference_to_stage
        add_reference_to_stage(
            usd_path=assets_root_path + "/Isaac/Environments/Simple_Warehouse/warehouse.usd",
            prim_path="/World/Warehouse"
        )

        self._h1 = H1FlatTerrainPolicy(
            prim_path="/World/H1",
            name="H1",
            usd_path=assets_root_path + "/Isaac/Robots/Unitree/H1/h1.usd",
            position=np.array([0, 0, 1.05]),
        )
        return []

    # ─── Post-load setup ────────────────────────────────────────────────────

    def setup(self):
        self._physics_ready = False
        self._base_command = np.array([0.0, 0.0, 0.0])
        self._latest_frame = None
        self._capture_pending = False
        self._warm_up = 0
        self._camera_logged_ready = False

        # Stop Replicator orchestrator from flooding kind=i,size=0 errors
        rep.orchestrator.set_capture_on_play(False)

        import omni.usd
        from pxr import Sdf, UsdGeom
        from isaacsim.core.prims import XFormPrim

        stage = omni.usd.get_context().get_stage()

        # Remove stale cameras from previous sessions
        for stale in ("/World/RobotCamera", ROBOT_CAM_PATH):
            prim = stage.GetPrimAtPath(stale)
            if prim.IsValid() and prim.GetTypeName() == "Camera":
                stage.RemovePrim(Sdf.Path(stale))

        # Create Camera USD prim under the D435 RGB link (moves with the robot)
        UsdGeom.Camera.Define(stage, ROBOT_CAM_PATH)
        # Quaternion [w,x,y,z] pointing forward-down from the chest mount
        XFormPrim(ROBOT_CAM_PATH).set_local_poses(
            orientations=np.array([[0.342, -0.940, 0.0, 0.0]])
        )
        print(f"[RoboScribe] Camera prim created at {ROBOT_CAM_PATH}")

        # Use Viewport 2 for the robot camera so the main viewport keeps its
        # free-perspective view. Falls back to the main viewport if not open.
        vp2 = vpu.get_viewport_from_window_name("Viewport 2")
        if vp2 is not None:
            vp2.camera_path = ROBOT_CAM_PATH
            self._vp = vp2
            print(f"[RoboScribe] Viewport 2 camera → {ROBOT_CAM_PATH}")
        else:
            # Fallback: use main viewport (opens Window → Viewport → Viewport 2 to avoid this)
            self._vp = vpu.get_active_viewport()
            if self._vp is not None:
                self._vp.camera_path = ROBOT_CAM_PATH
                print(f"[RoboScribe] Viewport camera → {ROBOT_CAM_PATH} "
                      f"(open Viewport 2 to keep free-camera view)")
            else:
                print("[RoboScribe] WARNING: no active viewport found")

        self._bridge = RoboScribeBridge(
            get_command_fn=lambda: self._base_command,
            set_command_fn=self._set_command,
            get_robot_fn=lambda: self._h1,
            get_frame_fn=lambda: self._latest_frame,
        )
        self._bridge.start()

        self._appwindow = omni.appwindow.get_default_app_window()
        self._input = carb.input.acquire_input_interface()
        self._keyboard = self._appwindow.get_keyboard()
        self._sub_keyboard = self._input.subscribe_to_keyboard_events(
            self._keyboard, self._on_keyboard_event
        )

    def _set_command(self, cmd):
        self._base_command[:] = cmd

    # ─── Physics step ───────────────────────────────────────────────────────

    def update(self, step: float):
        if self._physics_ready:
            self._h1.forward(step, self._base_command)
            if self._bridge is not None:
                self._bridge.record_step(step)
        else:
            self._physics_ready = True
            self._h1.initialize()
            self._h1.post_reset()
            self._h1.robot.set_joints_default_state(self._h1.default_pos)

        self._warm_up += 1

        # Request a viewport capture at ~5Hz; skip if previous capture not yet done
        if (self._vp is not None
                and not self._capture_pending
                and self._warm_up % CAPTURE_INTERVAL == 0):
            self._request_capture()

    def _request_capture(self):
        self._capture_pending = True
        vpu.capture_viewport_to_buffer(self._vp, self._on_capture)

    def _on_capture(self, buffer, buffer_size, width, height, fmt):
        try:
            ctypes.pythonapi.PyCapsule_GetPointer.restype  = ctypes.c_void_p
            ctypes.pythonapi.PyCapsule_GetPointer.argtypes = [ctypes.py_object, ctypes.c_char_p]
            c_ptr = ctypes.pythonapi.PyCapsule_GetPointer(buffer, None)

            arr = np.ctypeslib.as_array(
                (ctypes.c_uint8 * buffer_size).from_address(c_ptr)
            ).copy()

            self._latest_frame = arr.reshape(height, width, 4)[:, :, :3]

            if not self._camera_logged_ready:
                self._camera_logged_ready = True
                print(f"[RoboScribe] Camera ready — shape={self._latest_frame.shape}")

        except Exception as e:
            print(f"[RoboScribe] Capture error: {e}")
        finally:
            self._capture_pending = False

    # ─── Reset / Cleanup ────────────────────────────────────────────────────

    def reset(self):
        self._physics_ready = False
        self._warm_up = 0
        self._latest_frame = None
        self._capture_pending = False
        self._camera_logged_ready = False

    def cleanup(self):
        if self._bridge is not None:
            self._bridge.stop()
            self._bridge = None

        if self._sub_keyboard is not None and self._input is not None:
            self._input.unsubscribe_to_keyboard_events(self._keyboard, self._sub_keyboard)
            self._sub_keyboard = None

    # ─── Keyboard input ─────────────────────────────────────────────────────

    def _on_keyboard_event(self, event, *args, **kwargs) -> bool:
        if event.type == carb.input.KeyboardEventType.KEY_PRESS:
            if event.input.name in self._input_keyboard_mapping:
                self._base_command += self._input_keyboard_mapping[event.input.name]
        elif event.type == carb.input.KeyboardEventType.KEY_RELEASE:
            if event.input.name in self._input_keyboard_mapping:
                self._base_command -= self._input_keyboard_mapping[event.input.name]
        return True
