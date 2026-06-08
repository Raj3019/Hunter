"""
Auto-detect Foundit applications (read-only).

Foundit records every application the user makes under "My Applications". We read
that history with the user's durable login and flip any matching
``external_pending`` Hunter task to ``applied`` (or a later stage). This is
read-only — it never applies to anything — so it carries none of the risk of
automating Foundit's apply endpoint.

This mirrors ``services/naukri_apply_sync.py``. The only Foundit-specific unknown
is the "My Applies" history endpoint, isolated in
``FounditJobClient.get_application_history`` (see the placeholder note there).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Hunter statuses we still consider "open" and worth reconciling against Foundit.
PENDING_STATUSES = ["external_pending", "needs_review"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _map_history_status(history_status: str) -> str:
    """Map a Foundit history status onto a Hunter application status.

    Only ever advances from external_pending: applied -> viewed -> interview.
    """
    text = (history_status or "").lower()
    if any(k in text for k in ("shortlist", "interview", "selected", "offer", "hired")):
        return "interview"
    if "view" in text:  # "Application Viewed", "Profile Viewed"
        return "viewed"
    return "applied"  # "Applied", "Application Sent", etc.


async def reconcile_foundit_applications(db, user_id: str) -> dict:
    """Read Foundit application history and update matching pending Hunter tasks."""
    from portals.foundit.jobs import FounditJobClient
    from portals.foundit.session import get_valid_foundit_auth

    auth = await asyncio.to_thread(get_valid_foundit_auth, user_id)
    if auth is None:
        return {"connected": False, "updated": 0, "checked": 0}

    client = FounditJobClient(auth)
    try:
        history = await asyncio.to_thread(client.get_application_history)
    except Exception as exc:
        logger.info("Foundit application history unavailable for %s: %s", user_id, exc)
        return {"connected": True, "updated": 0, "checked": 0, "error": "history_unavailable"}

    applied: dict[str, dict] = {}
    for detail in history or []:
        job_id = str(detail.get("job_id") or "")
        if not job_id:
            continue
        applied[job_id] = detail

    if not applied:
        return {"connected": True, "updated": 0, "checked": 0}

    rows = db.table("applications").select(
        "id, status, job_id, jobs(job_id)",
    ).eq("user_id", user_id).eq("portal", "foundit").in_("status", PENDING_STATUSES).execute()
    pending = rows.data or []

    updated = 0
    now = _now()
    for row in pending:
        foundit_job_id = str(((row.get("jobs") or {}).get("job_id")) or "")
        if not foundit_job_id or foundit_job_id not in applied:
            continue
        detail = applied[foundit_job_id]
        status_value = detail.get("status_value") or "Applied"
        # Only the matched (few) applications pay for the extra per-application
        # call that surfaces recruiter-side viewed/shortlisted status.
        try:
            enriched = await asyncio.to_thread(
                client.get_application_status, detail.get("application_id"),
            )
            if enriched:
                status_value = enriched
        except Exception:
            logger.debug("Foundit status enrich failed for job %s", foundit_job_id, exc_info=True)
        new_status = _map_history_status(status_value)
        db.table("applications").update({
            "status": new_status,
            "updated_at": now,
            "external_apply_confirmed_at": now,
            "notes": f"Auto-detected from Foundit (status: {status_value}).",
            "portal_response": {
                "source": "foundit_history",
                "status_value": status_value,
            },
        }).eq("id", row["id"]).eq("user_id", user_id).execute()
        if row.get("job_id"):
            try:
                db.table("job_matches").update({"status": "applied"}).eq(
                    "user_id", user_id,
                ).eq("job_id", row["job_id"]).execute()
            except Exception:
                logger.debug("Could not update job_matches for %s", row.get("job_id"), exc_info=True)
        updated += 1

    return {"connected": True, "updated": updated, "checked": len(pending)}
