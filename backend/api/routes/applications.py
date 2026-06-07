from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import NULL_RESULT, get_db

router = APIRouter()
VALID_STATUSES = {
    "approved",
    "applied",
    "viewed",
    "interview",
    "offer",
    "rejected",
    "archived",
    "blocked",
    "failed",
    "needs_review",
    "external_pending",
}


# job_matches.status uses a narrower vocabulary than applications.status.
# Map advanced application lifecycle states onto valid match states so the
# job_matches row never holds an out-of-spec status.
MATCH_STATUS_FROM_APP = {
    "approved": "approved",
    "applied": "applied",
    "viewed": "applied",
    "interview": "applied",
    "offer": "applied",
    "rejected": "skipped",
    "archived": "skipped",
    "blocked": "blocked",
    "failed": "failed",
    "needs_review": "needs_review",
    "external_pending": "external_pending",
}


class StatusUpdate(BaseModel):
    status: str
    notes: str = ""


@router.get("")
async def get_applications(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("applications").select(
        "*, jobs(title, company, location, portal, apply_link, external_apply_url)"
    ).eq("user_id", user_id).order("applied_at", desc=True).execute()
    return {"applications": result.data or []}


@router.patch("/{app_id}")
async def update_application(
    app_id: str,
    body: StatusUpdate,
    user_id: str = Depends(get_current_user_id),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_STATUSES))}",
        )

    db = get_db()
    existing = db.table("applications").select(
        "id, status, job_id",
    ).eq("id", app_id).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    if not existing.data:
        raise HTTPException(status_code=404, detail="Application not found")

    payload = {
        "status": body.status,
        "notes": body.notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if existing.data.get("status") == "external_pending" and body.status == "applied":
        payload["external_apply_confirmed_at"] = datetime.now(timezone.utc).isoformat()

    db.table("applications").update(payload).eq("id", app_id).eq("user_id", user_id).execute()
    if existing.data.get("job_id"):
        db.table("job_matches").update({
            "status": MATCH_STATUS_FROM_APP.get(body.status, "applied"),
        }).eq("user_id", user_id).eq("job_id", existing.data["job_id"]).execute()
    return {"success": True, "status": body.status}
