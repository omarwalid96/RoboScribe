"""Optional outbound webhooks for observability and alerts.

- N8N_WEBHOOK_URL: JSON events for automation (Sheets, dashboards, branching).
- LOW_ACCURACY_ALERT_URL: optional second hook when execution accuracy is below threshold.
  Use a Discord incoming webhook URL here — we POST {"content": "..."} which Discord accepts.
  For Slack Incoming Webhooks, set ALERT_WEBHOOK_STYLE=slack (sends {"text": "..."}).
  For generic JSON (e.g. another n8n workflow), set ALERT_WEBHOOK_STYLE=json.

Failures are logged and never raise — same pattern as Convex optional integration.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL")
LOW_ACCURACY_ALERT_URL = os.getenv("LOW_ACCURACY_ALERT_URL")
LOW_ACCURACY_THRESHOLD = float(os.getenv("LOW_ACCURACY_THRESHOLD", "70"))
ALERT_WEBHOOK_STYLE = os.getenv("ALERT_WEBHOOK_STYLE", "discord").lower()


async def _post_json(url: str, payload: dict[str, Any]) -> None:
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
    except Exception as exc:
        logger.warning("Webhook POST failed (%s): %s", url[:48], exc)


async def trigger_n8n_webhook(payload: dict[str, Any]) -> None:
    """POST a JSON payload to N8N_WEBHOOK_URL if configured."""
    if not N8N_WEBHOOK_URL:
        return
    await _post_json(N8N_WEBHOOK_URL, payload)


def _format_low_accuracy_message(fields: dict[str, Any]) -> str:
    lines = [
        "**RoboScribe — low execution accuracy**",
        f"Time (UTC): {fields.get('timestamp', '')}",
        f"Command ID: {fields.get('command_id', '')}",
        f"User input: {fields.get('user_input', '')}",
        f"Parsed plan: {fields.get('parsed_summary', '')}",
        f"Overall accuracy: {fields.get('overall_accuracy')}% (threshold {fields.get('threshold')}%)",
        f"Distance acc: {fields.get('distance_accuracy')}% | Duration acc: {fields.get('duration_accuracy')}%",
        f"Outcome: {fields.get('outcome', '')}",
        f"Commanded vs actual distance (m): {fields.get('commanded_distance_m')} vs {fields.get('actual_distance_m')}",
        f"Commanded vs actual duration (s): {fields.get('commanded_duration_s')} vs {fields.get('actual_duration_s')}",
    ]
    if fields.get("heading_drift_deg") is not None:
        lines.append(f"Heading drift: {fields['heading_drift_deg']}°")
    return "\n".join(lines)


async def maybe_send_low_accuracy_alert(fields: dict[str, Any]) -> None:
    """Notify LOW_ACCURACY_ALERT_URL when overall_accuracy is below threshold."""
    if not LOW_ACCURACY_ALERT_URL:
        return
    acc = fields.get("overall_accuracy")
    if acc is None:
        return
    if acc >= LOW_ACCURACY_THRESHOLD:
        return

    text = _format_low_accuracy_message({**fields, "threshold": LOW_ACCURACY_THRESHOLD})

    if ALERT_WEBHOOK_STYLE == "slack":
        await _post_json(LOW_ACCURACY_ALERT_URL, {"text": text})
    elif ALERT_WEBHOOK_STYLE == "json":
        await _post_json(LOW_ACCURACY_ALERT_URL, {"event": "low_accuracy", **fields})
    else:
        # Discord incoming webhook (default)
        await _post_json(LOW_ACCURACY_ALERT_URL, {"content": text[:2000]})


async def send_observability_event(
    event: str,
    payload: dict[str, Any],
    *,
    low_accuracy_fields: dict[str, Any] | None = None,
) -> None:
    """Emit a timestamped event to n8n; optionally fan out a low-accuracy alert."""
    body = {
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    await trigger_n8n_webhook(body)
    if event == "execution_complete" and low_accuracy_fields is not None:
        await maybe_send_low_accuracy_alert(low_accuracy_fields)
