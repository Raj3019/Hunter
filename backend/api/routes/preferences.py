from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import get_db

router = APIRouter()


class PreferencesIn(BaseModel):
    job_titles: List[str] = []
    locations: List[str] = []
    work_type: List[str] = []
    min_salary: Optional[int] = 0
    max_salary: Optional[int] = 0
    experience_years: Optional[int] = 0
    avoid_companies: List[str] = []


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
