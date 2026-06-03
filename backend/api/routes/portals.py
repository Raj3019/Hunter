from fastapi import APIRouter, Depends
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import get_db

router = APIRouter()


class NaukriTokenIn(BaseModel):
    bearer_token: str
    profile_id: str


class FounditTokenIn(BaseModel):
    bearer_token: str
    user_id_str: str = ""


@router.post("/naukri/token")
async def save_naukri_token(
    body: NaukriTokenIn,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "naukri",
        "bearer_token": body.bearer_token,
        "profile_id": body.profile_id,
    }, on_conflict="user_id,portal").execute()
    return {"success": True, "portal": "naukri"}


@router.post("/foundit/token")
async def save_foundit_token(
    body: FounditTokenIn,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "foundit",
        "bearer_token": body.bearer_token,
        "profile_id": body.user_id_str,
    }, on_conflict="user_id,portal").execute()
    return {"success": True, "portal": "foundit"}


@router.post("/linkedin/setup")
async def confirm_linkedin_setup(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "linkedin",
        "chrome_profile_path": "./chrome_profiles/linkedin",
    }, on_conflict="user_id,portal").execute()
    return {"success": True, "portal": "linkedin"}


@router.get("/status")
async def get_portal_status(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    tokens = db.table("portal_tokens").select(
        "portal, profile_id, chrome_profile_path, created_at"
    ).eq("user_id", user_id).execute()

    company_accounts = db.table("company_accounts").select(
        "company_key, company_name, username, account_status"
    ).eq("user_id", user_id).execute()

    return {
        "portals": {row["portal"]: row for row in (tokens.data or [])},
        "company_accounts": company_accounts.data or [],
    }
