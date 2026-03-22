"""
Convex HTTP client for backend-initiated trajectory saves.

Uses Convex HTTP Actions (convex.site URL) — a public endpoint that requires
no deploy key, unlike the /api/mutation endpoint on convex.cloud.

Gracefully does nothing if CONVEX_SITE_URL is unset.
"""

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# The .convex.site URL hosts HTTP actions (public, no auth needed).
# Distinct from the .convex.cloud URL used by the React client.
CONVEX_SITE_URL = os.getenv("CONVEX_SITE_URL", "").rstrip("/")
_ENABLED = bool(CONVEX_SITE_URL)


async def save_trajectory(metadata: dict[str, Any]) -> str | None:
    """
    POST trajectory metadata to the Convex HTTP action at /save-trajectory.
    Returns the Convex document ID, or None on failure/disabled.
    """
    if not _ENABLED:
        logger.debug("[Convex] Skipped — CONVEX_SITE_URL not set")
        return None

    url = f"{CONVEX_SITE_URL}/save-trajectory"

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                json=metadata,
                headers={"Content-Type": "application/json"},
                timeout=10.0,
            )
            if resp.status_code == 200:
                doc_id = resp.json().get("id")
                logger.info(
                    "[Convex] Saved trajectory %s → doc %s",
                    metadata.get("trajectory_id"),
                    doc_id,
                )
                return doc_id
            else:
                logger.warning(
                    "[Convex] Save failed (HTTP %d): %s",
                    resp.status_code,
                    resp.text,
                )
                return None
    except Exception as exc:
        logger.warning("[Convex] Save error: %s", exc)
        return None
