import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import get_db
from core.encryption import encrypt
from portals.custom.account_login import is_session_active
from portals.custom.registry import COMPANY_PORTALS

router = APIRouter()


class CompanyAccountIn(BaseModel):
    company_key: str
    username: str
    password: str


class CompanyAccountStatusUpdate(BaseModel):
    account_status: str


@router.post("")
async def save_company_account(
    body: CompanyAccountIn,
    user_id: str = Depends(get_current_user_id),
):
    if body.company_key not in COMPANY_PORTALS:
        raise HTTPException(status_code=400, detail=f"Unknown company: {body.company_key}")

    encrypted = encrypt(body.password)
    body.password = ""

    company_info = COMPANY_PORTALS[body.company_key]
    db = get_db()
    db.table("company_accounts").upsert({
        "user_id": user_id,
        "company_key": body.company_key,
        "company_name": company_info["name"],
        "login_url": company_info["login_url"],
        "signup_url": company_info["signup_url"],
        "username": body.username,
        "password_encrypted": encrypted,
        "account_status": "active",
    }, on_conflict="user_id,company_key").execute()

    return {"success": True, "company": body.company_key, "username": body.username}


@router.get("")
async def list_company_accounts(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    rows = db.table("company_accounts").select(
        "company_key, company_name, username, account_status, last_login_at, signup_url"
    ).eq("user_id", user_id).execute()
    return {"accounts": rows.data}


@router.get("/{company_key}/status")
async def check_session_status(
    company_key: str,
    user_id: str = Depends(get_current_user_id),
):
    active = await is_session_active(company_key)
    return {"company_key": company_key, "session_active": active}


@router.delete("/{company_key}")
async def delete_company_account(
    company_key: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    db.table("company_accounts").delete().eq("user_id", user_id).eq("company_key", company_key).execute()

    company = COMPANY_PORTALS.get(company_key, {})
    profile_root = Path("./chrome_profiles/companies").resolve()
    profile_path = (profile_root / company.get("chrome_profile_subdir", company_key)).resolve()

    if os.path.exists(profile_path):
        if profile_root not in profile_path.parents:
            raise HTTPException(status_code=500, detail="Refusing to delete unexpected profile path")
        shutil.rmtree(profile_path)

    return {"success": True, "deleted": company_key}
