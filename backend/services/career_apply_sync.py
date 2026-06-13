"""Auto-detect & import company career-portal applications (read-only).

Logs in to the user's career portal (SuccessFactors or Infosys — dispatched by
``portals/career_portals.py``), reads their submitted applications, and **mirrors
them into Hunter's tracker**: each applied job becomes a tracked application
(created already marked applied/viewed/interview/etc., or its status updated if it
already exists). Read-only — it never applies to anything.

Why "import" and not just "update": these career portals are not *searched* by
Hunter, so Hunter never has a pre-existing record to advance (see
``docs/feature-specs/career-portal-applied-import.md``). So we create the record
from what we read. The logic here is **platform-agnostic** — it works on the
normalized applied-job list, so every current and future career portal that
provides that list gets import for free.

Each sync drives a headless login (heavy/slow), so it is throttled server-side
with a per-user+portal cooldown; the frontend can call it freely.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

COOLDOWN_SECONDS = 300  # headless login is heavy — at most once / 5 min per user+portal
_last_sync: dict[tuple[str, str], float] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _map_status(status_text: str) -> str | None:
    """Map a career-portal application status onto a Hunter application status.

    Returns one of applied/viewed/interview/offer/rejected, or None to skip a
    withdrawn/revoked application (it should not appear as an active application).
    """
    text = (status_text or "").lower()
    if any(k in text for k in ("withdraw", "revoke", "cancel")):
        return None
    if any(k in text for k in ("offer", "hired")):
        return "offer"
    if any(k in text for k in ("shortlist", "interview")):
        return "interview"
    if any(k in text for k in ("reject", "not selected", "regret", "unsuccessful", "not progress", "declin")):
        return "rejected"
    # "viewed" only for an explicit application/profile-viewed signal — NOT
    # "reviewing"/"under review"/"reviewed" (which is just the normal submitted state,
    # and which also contains the substring "view").
    if ("viewed" in text or "seen" in text) and "review" not in text:
        return "viewed"
    return "applied"  # "submitted", "reviewing", "received", "in progress", etc.


def _snapshot(portal_key: str, app: dict, label: str, home_url: str) -> dict:
    """Build a (sparse) jobs-table row for an imported application.

    Keyed on (portal, job_id) where job_id is the portal's application id, so the
    shared ``upsert_job`` de-duplicates on re-import (no migration needed).
    """
    return {
        "portal": portal_key,
        "job_id": str(app.get("application_id") or ""),
        "title": app.get("job_title") or "",
        "company": app.get("company") or label,
        "location": app.get("location") or "",
        "description": "",
        "salary": "",
        "experience": "",
        "tags": [],
        "apply_link": app.get("source_url") or home_url,
        "posted_date": "",
        "apply_method": "external",
        "external_apply_url": app.get("source_url") or home_url,
        "portal_metadata": {},
    }


async def reconcile_career_applications(db, user_id: str, portal_key: str) -> dict:
    """Read career-portal applications and import/update them into the tracker."""
    from portals.career_portals import (
        career_label,
        career_portal_home,
        get_career_credentials,
        login_and_fetch,
        set_career_auth_failed,
    )
    from services.job_discovery import upsert_job

    creds = await asyncio.to_thread(get_career_credentials, db, user_id, portal_key)
    if not creds:
        return {"connected": False, "imported": 0, "updated": 0, "checked": 0}

    key = (user_id, portal_key)
    if time.monotonic() - _last_sync.get(key, 0.0) < COOLDOWN_SECONDS:
        return {"connected": True, "imported": 0, "updated": 0, "checked": 0, "cooldown": True}

    username, password = creds
    try:
        result = await asyncio.to_thread(login_and_fetch, portal_key, username, password)
    except Exception as exc:
        logger.info("%s applied-status fetch failed for %s: %s", portal_key, user_id, exc)
        return {"connected": True, "imported": 0, "updated": 0, "checked": 0, "error": "fetch_failed"}
    finally:
        del password
    _last_sync[key] = time.monotonic()

    if not result.get("ok"):
        await asyncio.to_thread(set_career_auth_failed, db, user_id, portal_key, True)
        return {"connected": True, "imported": 0, "updated": 0, "checked": 0, "error": "login_failed"}
    await asyncio.to_thread(set_career_auth_failed, db, user_id, portal_key, False)

    applications = result.get("applications") or []
    if not applications:
        return {"connected": True, "imported": 0, "updated": 0, "checked": 0}

    label = career_label(portal_key)
    home_url = career_portal_home(portal_key)
    imported = updated = 0
    seen: set[str] = set()
    now = _now()

    for app in applications:
        app_id = str(app.get("application_id") or "")
        if not app_id or app_id in seen:
            continue
        seen.add(app_id)

        status_text = app.get("status") or "Applied"
        new_status = _map_status(status_text)
        if new_status is None:  # withdrawn/revoked — don't track as active
            continue

        # snapshot + dedup via the existing jobs (portal, job_id) unique key
        jobs_id = await asyncio.to_thread(upsert_job, db, _snapshot(portal_key, app, label, home_url))
        if not jobs_id:
            continue

        portal_response = {
            "source": f"{portal_key}_import",
            "application_id": app_id,
            "status_value": status_text,
        }
        existing = db.table("applications").select("id, status").eq(
            "user_id", user_id,
        ).eq("job_id", jobs_id).limit(1).execute()
        row = (existing.data or [None])[0]

        if row:
            if row.get("status") != new_status:
                db.table("applications").update({
                    "status": new_status,
                    "updated_at": now,
                    "external_apply_confirmed_at": now,
                    "notes": f"Imported from {label} careers (status: {status_text}).",
                    "portal_response": portal_response,
                }).eq("id", row["id"]).eq("user_id", user_id).execute()
                updated += 1
        else:
            db.table("applications").insert({
                "user_id": user_id,
                "job_id": jobs_id,
                "portal": portal_key,
                "status": new_status,
                "apply_mode": "manual",
                "pre_apply_check": {},
                "portal_response": portal_response,
                "external_apply_url": home_url,
                "tailored_resume_url": "",
                "resume_version": "",
                "blocked_reason": "",
                "failed_reason": "",
                "notes": f"Imported from {label} careers (status: {status_text}).",
                "external_apply_confirmed_at": now,
            }).execute()
            imported += 1

    return {"connected": True, "imported": imported, "updated": updated, "checked": len(applications)}
