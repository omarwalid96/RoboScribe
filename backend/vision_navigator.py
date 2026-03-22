"""
Visual navigation using Qwen3-VL-2B-Instruct for zero-shot object grounding.

Qwen3-VL outputs bounding boxes as JSON:
    [{"bbox_2d": [x1, y1, x2, y2], "label": "object"}]
Coordinates are in 0-1000 range, normalised to image size.

~4GB VRAM (bf16). Requires transformers>=4.56.0 and accelerate.

Usage:
    detection = locate_object(rgb_b64, "desk")
    if detection:
        cmd = compute_nav_command(detection["bbox"], depth_b64)
"""

import base64
import io
import json
import logging
import re
from typing import Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"

# Lazy-loaded globals
_model = None
_processor = None
_device = None

# Frame logging
_LOG_DIR = None
_frame_counter = 0


def _init_log_dir() -> str:
    import os
    global _LOG_DIR
    if _LOG_DIR is None:
        base = os.path.join(os.path.dirname(__file__), "..", "logs")
        _LOG_DIR = os.path.abspath(base)
        os.makedirs(_LOG_DIR, exist_ok=True)
    return _LOG_DIR


def _maybe_save_frame(image: "Image.Image", label: str = "") -> None:
    global _frame_counter
    _frame_counter += 1
    try:
        import os
        suffix = f"_{label}" if label else ""
        path = os.path.join(_init_log_dir(), f"frame_{_frame_counter:06d}{suffix}.png")
        image.save(path)
        logger.info("Frame saved → %s", path)
    except Exception as exc:
        logger.warning("Frame save failed: %s", exc)


def _load_model() -> None:
    global _model, _processor, _device
    if _model is not None:
        return

    import torch
    from transformers import Qwen3VLForConditionalGeneration, AutoProcessor

    # Suppress accelerate's verbose memory-allocation info log
    logging.getLogger("accelerate").setLevel(logging.WARNING)

    logger.info("Loading %s (~4GB VRAM, first-time only)…", MODEL_ID)

    _processor = AutoProcessor.from_pretrained(MODEL_ID)
    _model = Qwen3VLForConditionalGeneration.from_pretrained(
        MODEL_ID,
        dtype=torch.bfloat16,
        device_map="auto",
    ).eval()

    _device = next(_model.parameters()).device
    logger.info("Qwen3-VL loaded on %s", _device)


def _parse_bbox(text: str, img_w: int, img_h: int) -> Optional[list]:
    """
    Extract bounding box from Qwen3-VL JSON output.
    Coordinates are in 0-1000 range, normalised to image size.
    Returns [x1, y1, x2, y2] in pixels or None.
    """
    # Primary: JSON format [{"bbox_2d": [x1,y1,x2,y2], "label": "..."}]
    # Strip markdown code fences first, then match the outermost [...] array.
    clean = re.sub(r"```[a-z]*\n?", "", text).strip()
    json_match = re.search(r"\[\s*\{.*?\}\s*\]", clean, re.DOTALL)
    if json_match:
        try:
            boxes = json.loads(json_match.group())
            if boxes and "bbox_2d" in boxes[0]:
                x1, y1, x2, y2 = boxes[0]["bbox_2d"]
                x1 = x1 / 1000 * img_w
                y1 = y1 / 1000 * img_h
                x2 = x2 / 1000 * img_w
                y2 = y2 / 1000 * img_h
                return [x1, y1, x2, y2]
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    # Fallback: special token format (same as Qwen2-VL, 0-1000 coords)
    match = re.search(r"<\|box_start\|>\((\d+),(\d+)\),\((\d+),(\d+)\)<\|box_end\|>", text)
    if match:
        x1, y1, x2, y2 = [int(v) for v in match.groups()]
        x1 = x1 / 1000 * img_w
        y1 = y1 / 1000 * img_h
        x2 = x2 / 1000 * img_w
        y2 = y2 / 1000 * img_h
        return [x1, y1, x2, y2]

    return None


def locate_object(rgb_b64: str, target: str) -> Optional[dict]:
    """
    Find a named object using Qwen3-VL open-vocabulary grounding.

    Args:
        rgb_b64: Base64-encoded JPEG image
        target:  Object name, e.g. "cube", "desk", "forklift"

    Returns:
        {"bbox": [x1, y1, x2, y2], "cx": float, "cy": float} or None
    """
    _load_model()

    import torch

    try:
        image = Image.open(io.BytesIO(base64.b64decode(rgb_b64))).convert("RGB")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": (
                            f"Find the {target} in this image. "
                            f"Only respond if you can clearly see the {target} as a distinct, "
                            f"identifiable object — not a reflection, background pattern, or guess. "
                            f"Return a JSON list with one entry: "
                            f'[{{"bbox_2d": [x1, y1, x2, y2], "label": "{target}"}}] '
                            f"where x1,y1,x2,y2 are integers 0-1000 normalised to image size. "
                            f"The bounding box must tightly enclose only the {target} — "
                            f"never output the full image as the bounding box. "
                            f"If the {target} is absent or you are not confident, "
                            f"reply with exactly: not found"
                        ),
                    },
                ],
            }
        ]

        inputs = _processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        ).to(_device)

        with torch.no_grad():
            generated_ids = _model.generate(
                **inputs,
                max_new_tokens=128,
                do_sample=False,
                temperature=1.0,
            )

        generated_ids_trimmed = [
            out[len(inp):] for inp, out in zip(inputs["input_ids"], generated_ids)
        ]
        output_text = _processor.batch_decode(
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0]

        logger.info("Qwen3-VL raw output: %s", output_text.strip())

        # Strip <think>...</think> blocks before parsing — Qwen3 adds chain-of-thought
        # that may contain "not found" references unrelated to the final answer.
        answer = re.sub(r"<think>.*?</think>", "", output_text, flags=re.DOTALL).strip()
        logger.info("Qwen3-VL answer (stripped): %s", answer)

        if "not found" in answer.lower():
            logger.info("Qwen3-VL: '%s' not found in frame", target)
            _maybe_save_frame(image, f"miss_{target}")
            return None

        bbox = _parse_bbox(answer, image.width, image.height)
        if bbox is None:
            logger.info("Qwen3-VL: no bbox parsed for '%s' — output: %s", target, output_text.strip())
            _maybe_save_frame(image, f"parse_fail_{target}")
            return None

        x1, y1, x2, y2 = bbox

        # Reject hallucinations: full-frame boxes (> 35% area) or pixel-noise (< 0.1%)
        bbox_area = (x2 - x1) * (y2 - y1)
        img_area = image.width * image.height
        area_ratio = bbox_area / max(img_area, 1)
        if area_ratio > 0.35:
            logger.info(
                "Qwen3-VL: bbox rejected — full-frame hallucination (area=%.1f%%) for '%s'",
                area_ratio * 100, target,
            )
            _maybe_save_frame(image, f"reject_{target}")
            return None
        if area_ratio < 0.001:
            logger.info(
                "Qwen3-VL: bbox rejected — too small (area=%.3f%%) for '%s'",
                area_ratio * 100, target,
            )
            _maybe_save_frame(image, f"reject_{target}")
            return None
        logger.info(
            "Qwen3-VL: '%s' at [%.0f,%.0f,%.0f,%.0f] (cx=%.0f cy=%.0f)",
            target, x1, y1, x2, y2, (x1 + x2) / 2, (y1 + y2) / 2,
        )
        _maybe_save_frame(image, f"hit_{target}")
        return {"bbox": bbox, "cx": (x1 + x2) / 2, "cy": (y1 + y2) / 2}

    except Exception as exc:
        logger.error("Qwen3-VL inference error: %s", exc, exc_info=True)
        return None


def compute_nav_command(
    bbox: list,
    depth_b64: Optional[str] = None,
    image_width: int = 1280,
) -> dict:
    """
    Reactive P-controller: turn toward the detected object and walk forward.

    bearing_error ∈ [-1, +1]: negative = target left of center, positive = right.
    wz = bearing_error × gain  →  turns toward target (positive wz = CW/right).
    vx slows proportionally while turning so the robot doesn't overshoot.
    """
    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2

    bearing_error = (cx - image_width / 2) / (image_width / 2)

    distance = 5.0
    if depth_b64:
        try:
            depth_arr = np.array(
                Image.open(io.BytesIO(base64.b64decode(depth_b64))).convert("L"),
                dtype=np.float32,
            ) / 255.0
            cy = (y1 + y2) / 2
            h, w = depth_arr.shape
            px = int(min(max(cx, 0), w - 1))
            py = int(min(max(cy, 0), h - 1))
            r = 2
            patch = depth_arr[max(0, py - r):py + r + 1, max(0, px - r):px + r + 1]
            valid = patch[patch > 0.0]
            if valid.size > 0:
                distance = float(valid.mean()) * 10.0
        except Exception:
            pass

    # Proximity proxy from bbox width when no depth: object fills >25% of frame → close
    bbox_width_ratio = (x2 - x1) / image_width
    arrived = distance < 3.0 or bbox_width_ratio > 0.25

    # H1 controller: positive wz = CW (clockwise / right turn).
    # bearing_error > 0 → object is RIGHT → positive wz rotates right toward it.
    wz = 0.0 if arrived else max(-0.2, min(0.2, bearing_error * 0.15))
    vx = 0.0 if arrived else 0.1 * max(0.0, 1.0 - abs(bearing_error))

    return {
        "vx": round(vx, 3),
        "wz": round(wz, 3),
        "arrived": arrived,
        "distance": round(distance, 2),
        "bearing": round(bearing_error, 3),
    }


class NavigationSession:
    """Tracks state for an ongoing visual navigation session."""

    MAX_LOST_FRAMES = 10

    def __init__(self, target: str, command_id: str, max_steps: int = 300):
        self.target = target
        self.command_id = command_id
        self.max_steps = max_steps
        self.step = 0
        self.lost_frames = 0
        self.active = True

    def tick(self, detected: bool) -> bool:
        self.step += 1
        self.lost_frames = 0 if detected else self.lost_frames + 1
        if self.step >= self.max_steps or self.lost_frames >= self.MAX_LOST_FRAMES:
            self.active = False
        return self.active

    @property
    def stop_reason(self) -> str:
        if self.step >= self.max_steps:
            return "timeout"
        if self.lost_frames >= self.MAX_LOST_FRAMES:
            return "target lost"
        return "arrived"
