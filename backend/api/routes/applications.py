from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import get_db

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
}


class StatusUpdate(BaseModel):
    status: str
    notes: str = ""


@router.get("")
async def get_applications(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("applications").select(
        "*, jobs(title, company, location, portal, apply_link)"
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
    db.table("applications").update({
        "status": body.status,
        "notes": body.notes,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", app_id).eq("user_id", user_id).execute()
    return {"success": True, "status": body.status}
