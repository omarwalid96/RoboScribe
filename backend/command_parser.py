import os
import re
import json
import logging
import httpx

logger = logging.getLogger(__name__)

FEATHERLESS_API_KEY = os.getenv("FEATHERLESS_API_KEY")
FEATHERLESS_MODEL = os.getenv("FEATHERLESS_MODEL", "deepseek-ai/DeepSeek-V3-0324")
FEATHERLESS_BASE_URL = "https://api.featherless.ai/v1"

SYSTEM_PROMPT = """You are a motion planner for a bipedal robot operating in walking-only mode.
The robot is constrained to planar (X-Y) motion with exactly three control inputs per step:

  vx  ∈ [-1.0, 1.0] m/s   — forward(+) / backward(-) body velocity
  vy  ∈ [-1.0, 1.0] m/s   — lateral left(+) / right(-) body velocity
  wz  ∈ [-1.0, 1.0] rad/s — yaw angular velocity CCW(+) / CW(-)

Nominal values: walking speed = 0.75 m/s, turning rate = 0.75 rad/s, max = 1.0 m/s.
There is no higher-level joint control — only vx, vy, wz.

## Planar Motion Geometry

Setting vx and wz simultaneously traces a CIRCULAR ARC (not a straight line + turn):
  Arc radius  R = vx / wz  (metres)
  Arc length    = |vx| × duration
  Angle swept   = |wz| × duration  (radians)
  Full circle: duration = 2π / |wz|

Key arc examples:
  Circle R=1m:  vx=0.5,  wz=0.5  → full circle in 12.57 s
  Circle R=0.5m: vx=0.375, wz=0.75 → full circle in 8.38 s
  Wide arc:     vx=0.75, wz=0.3  → R=2.5 m
  Tight spin:   vx=0.0,  wz=1.0  → rotate in place

Straight motion: wz=0. Pure rotation: vx=0, vy=0.
Distance for straight steps = |vx| × duration.
Angle for pure-rotation steps = |wz| × duration.
  90°  = 2.09 s at wz=0.75
  180° = 4.19 s at wz=0.75
  360° = 8.38 s at wz=0.75

## Speed Concepts
  slow / careful / sneak  → vx ∈ [0.2, 0.4]
  normal / walk           → vx = 0.75
  fast / run / jog        → vx ∈ [0.85, 1.0]
  accelerate              → ramp: 0.25 → 0.5 → 0.75 across steps
  decelerate / brake      → ramp: 0.75 → 0.5 → 0.25 → 0.0

## Motion Concept Library
Map intent to vx/vy/wz patterns before calculating durations:
  STRAIGHT LINE    vx=0.75, vy=0, wz=0
  BACKWARD         vx=-0.75, vy=0, wz=0
  SPIN IN PLACE    vx=0, vy=0, wz=±0.75  (+ = CCW/left)
  STRAFE           vx=0, vy=±0.5, wz=0
  CIRCLE (arc)     vx and wz same sign → left circle; opposite sign → right circle
  FIGURE-8         two half-circles with wz sign flipped between them
  SQUARE           4 × (straight segment + 90° spin-in-place)
  ZIGZAG           alternating vy=+0.4 and vy=-0.4 with vx=0.5, short durations
  PATROL           straight → 180° spin → straight (repeat)
  SPIRAL OUT       circle steps with wz decreasing each loop (radius grows)
  SPIRAL IN        circle steps with wz increasing each loop (radius shrinks)
  ACCELERATION     ramp vx up across 3-4 steps then sustain
  DECELERATION     sustain then ramp vx down to 0 across 3-4 steps
  DRUNK / WOBBLE   vx=0.5 with alternating small wz ±0.3 steps

## Output Format

Single continuous motion → one step:
{"type": "single", "vx": 0.75, "vy": 0.0, "wz": 0.0, "duration": 1.33, "description": "walk forward 1 metre"}

Pattern / multi-phase / acceleration → sequence (max 24 steps):
{"type": "sequence", "description": "...", "total_duration": X.XX, "steps": [
  {"vx": ..., "vy": ..., "wz": ..., "duration": ...},
  ...
]}
total_duration must equal the sum of all step durations.

Navigate to a named object using the onboard camera (visual grounding):
{"type": "navigate", "target": "<object_name>", "description": "navigate to the <object_name>"}
Use for: "go to", "navigate to", "move to", "walk to", "find the", "head to".
The object_name should be a simple noun (e.g. "desk", "shelf", "forklift", "pallet", "crate").

Respond ONLY with valid JSON. No markdown, no explanation. If unclear, return {"error": "reason"}."""


def _regex_fallback(text: str) -> dict | None:
    """Simple regex fallback when no API key is set. Only handles single commands."""
    text_lower = text.lower().strip()

    if re.search(r"\bstop\b", text_lower):
        return {"type": "single", "vx": 0.0, "vy": 0.0, "wz": 0.0, "duration": 0.1,
                "description": "stop all movement"}

    # Extract optional distance (e.g. "2 meters", "0.5m")
    dist_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:meter|metre|m)\b", text_lower)
    dist = float(dist_match.group(1)) if dist_match else None

    if re.search(r"\bforward\b", text_lower):
        speed = 0.75
        duration = round(dist / speed, 2) if dist else 2.0
        return {"type": "single", "vx": speed, "vy": 0.0, "wz": 0.0, "duration": duration,
                "description": f"walk forward at {speed} m/s for {duration:.2f} seconds"}

    if re.search(r"\bbackward|back\b", text_lower):
        speed = 0.75
        duration = round(dist / speed, 2) if dist else 2.0
        return {"type": "single", "vx": -speed, "vy": 0.0, "wz": 0.0, "duration": duration,
                "description": f"walk backward at {speed} m/s for {duration:.2f} seconds"}

    # Extract optional angle (e.g. "90 degrees", "45°")
    angle_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:degree|deg|°)", text_lower)
    angle_deg = float(angle_match.group(1)) if angle_match else None

    if re.search(r"\bturn\s+left\b|\bleft\b", text_lower):
        rate = 0.75
        duration = round((angle_deg * (3.14159 / 180)) / rate, 2) if angle_deg else 2.09
        return {"type": "single", "vx": 0.0, "vy": 0.0, "wz": rate, "duration": duration,
                "description": f"turn left at {rate} rad/s for {duration:.2f} seconds"}

    if re.search(r"\bturn\s+right\b|\bright\b", text_lower):
        rate = 0.75
        duration = round((angle_deg * (3.14159 / 180)) / rate, 2) if angle_deg else 2.09
        return {"type": "single", "vx": 0.0, "vy": 0.0, "wz": -rate, "duration": duration,
                "description": f"turn right at {rate} rad/s for {duration:.2f} seconds"}

    # Navigate to named object
    nav_match = re.search(
        r"(?:go|navigate|move|walk|head)\s+to(?:\s+the)?\s+(\w+(?:\s+\w+)?)",
        text_lower,
    )
    if nav_match:
        target = nav_match.group(1).strip()
        return {"type": "navigate", "target": target, "description": f"navigate to the {target}"}

    logger.warning("Regex fallback could not parse: %s", text)
    return None


def _parse_diagnostics(
    *,
    user_input: str,
    parse_source: str,
    llm_raw: str | None = None,
    model: str | None = None,
) -> dict:
    """Structured logging for webhooks: user text, raw LLM string, parser path."""
    return {
        "user_input": user_input,
        "parse_source": parse_source,
        "llm_raw": llm_raw,
        "model": model,
    }


async def parse_command_with_llm(text: str) -> tuple[dict | None, dict]:
    """Parse a natural language command into velocity parameters.

    Falls back to regex if FEATHERLESS_API_KEY is not set or LLM errors.

    Returns ``(parsed_dict | None, diagnostics)`` where diagnostics always includes
    ``user_input``, ``parse_source`` (``llm`` | ``regex`` | ``regex_fallback``),
    ``llm_raw`` (assistant content when Featherless was called), and ``model``.
    """
    if not FEATHERLESS_API_KEY:
        logger.warning("FEATHERLESS_API_KEY not set — using regex fallback")
        fb = _regex_fallback(text)
        return fb, _parse_diagnostics(user_input=text, parse_source="regex", model=None)

    payload = {
        "model": FEATHERLESS_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
    }

    raw_content: str | None = None
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{FEATHERLESS_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {FEATHERLESS_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            raw_content = resp.json()["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        logger.error("Featherless API error: %s — falling back to regex", exc)
        fb = _regex_fallback(text)
        return fb, _parse_diagnostics(
            user_input=text,
            parse_source="regex_fallback",
            llm_raw=None,
            model=FEATHERLESS_MODEL,
        )

    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw_content)
    raw = re.sub(r"\s*```$", "", raw)

    base_diag = _parse_diagnostics(
        user_input=text,
        parse_source="llm",
        llm_raw=raw_content,
        model=FEATHERLESS_MODEL,
    )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.error("LLM returned non-JSON: %s", raw)
        fb = _regex_fallback(text)
        return fb, {**base_diag, "parse_source": "regex_fallback"}

    if "error" in parsed:
        logger.warning("LLM returned error: %s", parsed["error"])
        return None, base_diag

    cmd_type = parsed.get("type", "single")

    if cmd_type == "navigate":
        target = parsed.get("target", "").strip()
        if not target:
            logger.error("Navigate command missing target: %s", parsed)
            fb = _regex_fallback(text)
            return fb, {**base_diag, "parse_source": "regex_fallback"}
        parsed.setdefault("description", f"navigate to the {target}")
        parsed["type"] = "navigate"
        return parsed, base_diag

    if cmd_type == "sequence":
        steps = parsed.get("steps")
        if not isinstance(steps, list) or len(steps) == 0:
            logger.error("LLM sequence missing steps: %s", parsed)
            fb = _regex_fallback(text)
            return fb, {**base_diag, "parse_source": "regex_fallback"}
        for step in steps:
            if not {"vx", "vy", "wz", "duration"}.issubset(step.keys()):
                logger.error("LLM sequence step missing keys: %s", step)
                fb = _regex_fallback(text)
                return fb, {**base_diag, "parse_source": "regex_fallback"}
        # Compute total_duration if not provided
        if "total_duration" not in parsed:
            parsed["total_duration"] = round(sum(s["duration"] for s in steps), 2)
        if "description" not in parsed:
            parsed["description"] = f"sequence of {len(steps)} steps"
        parsed["type"] = "sequence"
        return parsed, base_diag

    # Single command — validate required keys
    required = {"vx", "vy", "wz", "duration", "description"}
    if not required.issubset(parsed.keys()):
        logger.error("LLM response missing keys: %s", parsed)
        fb = _regex_fallback(text)
        return fb, {**base_diag, "parse_source": "regex_fallback"}

    parsed["type"] = "single"
    return parsed, base_diag
