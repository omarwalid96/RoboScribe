"""
UIBuilder for RoboScribe H1 Bridge Extension

Mirrors the OpenArm RMPFlow bimanual pattern with H1-specific settings:
- physics_dt = 1/200 (200Hz)
- rendering_dt = 8/200 (25Hz)
- Camera positioned to view the humanoid
- Optional bridge status indicator
"""

import omni.timeline
import omni.ui as ui
from isaacsim.core.api.world import World
from isaacsim.core.utils.stage import create_new_stage, get_current_stage
from isaacsim.core.utils.viewports import set_camera_view
from isaacsim.gui.components.element_wrappers import CollapsableFrame, StateButton
from isaacsim.examples.extension.core_connectors import LoadButton, ResetButton
from isaacsim.gui.components.style import get_style
from omni.usd import StageEventType
from pxr import Sdf, UsdLux

from isaacsim.core.prims import SingleXFormPrim as XFormPrim

from .scenario import RoboScribeH1Scenario


class UIBuilder:
    def __init__(self):
        self.frames = []
        self.wrapped_ui_elements = []
        self._timeline = omni.timeline.get_timeline_interface()
        self._status_label = None
        self._on_init()

    def on_menu_callback(self):
        pass

    def on_timeline_event(self, event):
        if event.type == int(omni.timeline.TimelineEventType.STOP):
            self._scenario_state_btn.reset()
            self._scenario_state_btn.enabled = False

    def on_physics_step(self, step: float):
        # Update bridge status label at low cost (string compare)
        if self._status_label is not None and self._scenario is not None:
            bridge = getattr(self._scenario, "_bridge", None)
            if bridge is not None:
                status = bridge.status_text
                try:
                    self._status_label.text = f"Bridge: {status}"
                except Exception:
                    pass

    def on_stage_event(self, event):
        if event.type == int(StageEventType.OPENED):
            self._reset_extension()

    def cleanup(self):
        for ui_elem in self.wrapped_ui_elements:
            ui_elem.cleanup()

    def build_ui(self):
        # ── World Controls ──────────────────────────────────────────────────
        world_controls_frame = CollapsableFrame("World Controls", collapsed=False)
        with world_controls_frame:
            with ui.VStack(style=get_style(), spacing=5, height=0):
                self._load_btn = LoadButton(
                    "Load Button",
                    "LOAD",
                    setup_scene_fn=self._setup_scene,
                    setup_post_load_fn=self._setup_scenario,
                )
                self._load_btn.set_world_settings(
                    physics_dt=1.0 / 200.0,
                    rendering_dt=8.0 / 200.0,
                )
                self.wrapped_ui_elements.append(self._load_btn)

                self._reset_btn = ResetButton(
                    "Reset Button", "RESET",
                    pre_reset_fn=None,
                    post_reset_fn=self._on_post_reset_btn,
                )
                self._reset_btn.enabled = False
                self.wrapped_ui_elements.append(self._reset_btn)

        # ── Run Scenario ────────────────────────────────────────────────────
        run_scenario_frame = CollapsableFrame("Run Scenario")
        with run_scenario_frame:
            with ui.VStack(style=get_style(), spacing=5, height=0):
                self._scenario_state_btn = StateButton(
                    "Run Scenario",
                    "RUN",
                    "STOP",
                    on_a_click_fn=self._on_run_scenario_a_text,
                    on_b_click_fn=self._on_run_scenario_b_text,
                    physics_callback_fn=self._update_scenario,
                )
                self._scenario_state_btn.enabled = False
                self.wrapped_ui_elements.append(self._scenario_state_btn)

        # ── Bridge Status ───────────────────────────────────────────────────
        bridge_status_frame = CollapsableFrame("Bridge Status", collapsed=False)
        with bridge_status_frame:
            with ui.VStack(style=get_style(), spacing=5, height=0):
                self._status_label = ui.Label(
                    "Bridge: Disconnected",
                    style={"color": ui.color(0.8, 0.8, 0.8, 1.0)},
                )

    # ─── Internal callbacks ─────────────────────────────────────────────────

    def _on_init(self):
        self._scenario = RoboScribeH1Scenario()

    def _add_light_to_stage(self):
        sphereLight = UsdLux.SphereLight.Define(get_current_stage(), Sdf.Path("/World/SphereLight"))
        sphereLight.CreateRadiusAttr(2)
        sphereLight.CreateIntensityAttr(100000)
        XFormPrim(str(sphereLight.GetPath())).set_world_pose([6.5, 0, 12])

    def _setup_scene(self):
        create_new_stage()
        # self._add_light_to_stage()  # The warehouse environment provides its own lighting
        set_camera_view(eye=[3.0, 3.0, 2.0], target=[0, 0, 0.5], camera_prim_path="/OmniverseKit_Persp")

        loaded_objects = self._scenario.load_example_assets()

        world = World.instance()
        for obj in loaded_objects:
            world.scene.add(obj)

    def _setup_scenario(self):
        self._scenario.setup()
        self._scenario_state_btn.reset()
        self._scenario_state_btn.enabled = True
        self._reset_btn.enabled = True

    def _on_post_reset_btn(self):
        self._scenario.reset()
        self._scenario_state_btn.reset()
        self._scenario_state_btn.enabled = True

    def _update_scenario(self, step: float):
        self._scenario.update(step)

    def _on_run_scenario_a_text(self):
        self._timeline.play()

    def _on_run_scenario_b_text(self):
        self._timeline.pause()

    def _reset_extension(self):
        self._on_init()
        self._reset_ui()

    def _reset_ui(self):
        self._scenario_state_btn.reset()
        self._scenario_state_btn.enabled = False
        self._reset_btn.enabled = False
        if self._status_label is not None:
            self._status_label.text = "Bridge: Disconnected"
