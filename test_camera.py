"""
Test viewport camera switch + capture.
Run from Script Editor with H1 loaded and simulation PLAYING.
"""
import ctypes
import numpy as np
import omni.kit.viewport.utility as vpu
from PIL import Image
import os

ROBOT_CAM = "/World/H1/d435_rgb_module_link/Camera"

vp = vpu.get_active_viewport()
print(f"Before: viewport camera = {vp.camera_path}")

vp.camera_path = ROBOT_CAM
print(f"After:  viewport camera = {vp.camera_path}")

def _on_capture(buffer, buffer_size, width, height, fmt):
    try:
        ctypes.pythonapi.PyCapsule_GetPointer.restype  = ctypes.c_void_p
        ctypes.pythonapi.PyCapsule_GetPointer.argtypes = [ctypes.py_object, ctypes.c_char_p]
        c_ptr = ctypes.pythonapi.PyCapsule_GetPointer(buffer, None)
        arr = np.ctypeslib.as_array((ctypes.c_uint8 * buffer_size).from_address(c_ptr)).copy()
        rgb = arr.reshape(height, width, 4)[:, :, :3]
        out = os.path.join(os.path.dirname(__file__), "test_robot_cam.png")
        Image.fromarray(rgb).save(out)
        print(f"Saved → {out}  shape={rgb.shape}")
    except Exception as e:
        print(f"Error: {e}")

vpu.capture_viewport_to_buffer(vp, _on_capture)
print("Capture requested — check test_robot_cam.png")
