from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.auth import get_current_user_id
from core.database import get_db

router = APIRouter()


class PreferencesIn(BaseModel):
    job_titles: List[str] = Field(default_factory=list)
    locations: List[str] = Field(default_factory=list)
    work_type: List[str] = Field(default_factory=list)
    min_salary: Optional[int] = 0
    max_salary: Optional[int] = 0
    experience_years: Optional[int] = 0
    avoid_companies: List[str] = Field(default_factory=list)
    apply_mode: Optional[Literal["manual", "auto"]] = "manual"
    auto_apply_enabled: Optional[bool] = False
    auto_apply_daily_limit: Optional[int] = 10
    auto_apply_min_score: Optional[int] = 75
    auto_apply_allowed_portals: List[str] = Field(default_factory=list)
    safe_apply_start_time: Optional[str] = "09:00"
    safe_apply_end_time: Optional[str] = "20:00"
    require_tailored_resume_approval: Optional[bool] = True


@router.post("")
async def save_preferences(
    body: PreferencesIn,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    payload = {
        "user_id": user_id,
        **body.dict(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("preferences").upsert(payload, on_conflict="user_id").execute()
    return {"success": True}


@router.get("")
async def get_preferences(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("preferences").select("*").eq(
        "user_id",
        user_id,
    ).maybe_single().execute()
    return result.data or {}
