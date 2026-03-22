"""
Quick test for Qwen3-VL-2B vision navigator.
Run from the backend directory:
    cd backend && python test_vlm.py
"""

import base64
import sys
import os

# ── Test image: use test_frame.png from Isaac Sim capture if it exists ───────
FRAME_PATH = "download.jpeg"

if os.path.exists(FRAME_PATH):
    print(f"Using captured frame: {FRAME_PATH}")
    with open(FRAME_PATH, "rb") as f:
        rgb_b64 = base64.b64encode(f.read()).decode()
else:
    # Fallback: download a simple test image
    print("test_frame.png not found — downloading a test image...")
    import urllib.request
    url = "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/1200px-Cat03.jpg"
    tmp = "/tmp/test_vlm_img.jpg"
    urllib.request.urlretrieve(url, tmp)
    with open(tmp, "rb") as f:
        rgb_b64 = base64.b64encode(f.read()).decode()
    print(f"Downloaded test image to {tmp}")

# ── Run locate_object ─────────────────────────────────────────────────────────
from vision_navigator import locate_object, compute_nav_command

target = sys.argv[1] if len(sys.argv) > 1 else "cube"
print(f"\nLooking for: '{target}'")
print("Loading model (first run downloads ~4GB)...")

import logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")

result = locate_object(rgb_b64, target)

if result:
    print(f"\n✓ Found '{target}':")
    print(f"  bbox: {[round(v, 1) for v in result['bbox']]}")
    print(f"  center: cx={result['cx']:.0f} cy={result['cy']:.0f}")
    nav = compute_nav_command(result["bbox"])
    print(f"  nav command: vx={nav['vx']} wz={nav['wz']} bearing={nav['bearing']:.2f}")
else:
    print(f"\n✗ '{target}' not found in image")
