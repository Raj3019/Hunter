"""
Auto-detect Naukri applications (read-only).

Naukri records every application the user makes (manual or otherwise) under
"My Naukri -> Applied". We read that history with the user's durable login and
flip any matching ``external_pending`` Hunter task to ``applied`` (or a later
stage). This is read-only — it never applies to anything — so it carries none of
the risk of automating Naukri's apply endpoint.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Hunter statuses we still consider "open" and worth reconciling against Naukri.
PENDING_STATUSES = ["external_pending", "needs_review"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _map_history_status(history_status: str) -> str:
    """Map a Naukri history status onto a Hunter application status.

    Only ever advances from external_pending: applied -> viewed -> interview.
    """
    text = (history_status or "").lower()
    if any(k in text for k in ("shortlist", "interview", "selected", "offer")):
        return "interview"
    if "view" in text:  # "Application Viewed", "Profile Viewed"
        return "viewed"
    return "applied"  # "Application Sent", "Applied", etc.


def _extract_history_detail(detail: dict) -> dict:
    statuses = detail.get("status") or []
    latest = statuses[-1].get("statusValue") if statuses else "Applied"
    company_rating = None
    rating = detail.get("companyRating")
    if isinstance(rating, dict) and rating.get("AggregateRating"):
        try:
            company_rating = round(float(rating["AggregateRating"]), 1)
        except (TypeError, ValueError):
            company_rating = None
    return {
        "status_value": latest,
        "ars_score": detail.get("arsScore"),
        "company_rating": company_rating,
        "is_open": str(detail.get("isOpen")).lower() == "true",
    }


async def reconcile_naukri_applications(db, user_id: str) -> dict:
    """Read Naukri application history and update matching pending Hunter tasks."""
    from portals.naukri.jobs import NaukriJobClient
    from portals.naukri.session import get_valid_naukri_auth

    auth = await asyncio.to_thread(get_valid_naukri_auth, user_id)
    if auth is None:
        return {"connected": False, "updated": 0, "checked": 0}

    client = NaukriJobClient(auth)
    try:
        history = await asyncio.to_thread(client.get_application_history, 50, 90, 1)
    except Exception as exc:
        logger.info("Naukri application history unavailable for %s: %s", user_id, exc)
        return {"connected": True, "updated": 0, "checked": 0, "error": "history_unavailable"}

    applied: dict[str, dict] = {}
    for detail in history.get("applyDetails") or []:
        job_id = str(detail.get("jobId") or "")
        if not job_id:
            continue
        applied[job_id] = _extract_history_detail(detail)

    if not applied:
        return {"connected": True, "updated": 0, "checked": 0}

    rows = db.table("applications").select(
        "id, status, job_id, jobs(job_id)",
    ).eq("user_id", user_id).eq("portal", "naukri").in_("status", PENDING_STATUSES).execute()
    pending = rows.data or []

    updated = 0
    now = _now()
    for row in pending:
        naukri_job_id = str(((row.get("jobs") or {}).get("job_id")) or "")
        if not naukri_job_id or naukri_job_id not in applied:
            continue
        detail = applied[naukri_job_id]
        new_status = _map_history_status(detail["status_value"])
        db.table("applications").update({
            "status": new_status,
            "updated_at": now,
            "external_apply_confirmed_at": now,
            "notes": f"Auto-detected from Naukri (status: {detail['status_value']}).",
            "portal_response": {
                "source": "naukri_history",
                "status_value": detail["status_value"],
                "ars_score": detail["ars_score"],
                "company_rating": detail["company_rating"],
                "is_open": detail["is_open"],
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
