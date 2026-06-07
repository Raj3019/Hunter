import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import get_db
from core.encryption import encrypt
from portals.naukri.connect import get_naukri_connect_status, start_naukri_connect
from portals.naukri.session import login_with_credentials, naukri_status, set_auth_failed

logger = logging.getLogger(__name__)
router = APIRouter()


class NaukriTokenIn(BaseModel):
    bearer_token: str
    profile_id: str


class NaukriCredentialsIn(BaseModel):
    username: str
    password: str


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


@router.post("/naukri/credentials")
async def save_naukri_credentials(
    body: NaukriCredentialsIn,
    user_id: str = Depends(get_current_user_id),
):
    """Connect Naukri with credentials for a durable, auto-refreshing session.

    The password is validated with a live login, encrypted immediately, and never
    returned. The captured token is cached so the very first search is fast; it is
    silently re-minted from the stored credentials whenever it expires.
    """
    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=400, detail="Enter your Naukri email and password.")

    try:
        session = await asyncio.to_thread(login_with_credentials, username, body.password)
    except Exception as exc:
        logger.warning("Naukri credential login failed for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=400,
            detail="Could not sign in to Naukri with those credentials. Check your email/password and try again.",
        ) from exc

    encrypted = encrypt(body.password)
    body.password = ""

    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "naukri",
        "bearer_token": session["bearer_token"],
        "profile_id": session.get("profile_id") or None,
        "expires_at": session.get("expires_at"),
        "username": username,
        "password_encrypted": encrypted,
    }, on_conflict="user_id,portal").execute()
    set_auth_failed(db, user_id, False)

    return {"success": True, "portal": "naukri", "username": username}


@router.delete("/naukri")
async def disconnect_naukri(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("portal_tokens").delete().eq("user_id", user_id).eq("portal", "naukri").execute()
    return {"success": True, "portal": "naukri", "disconnected": True}


@router.post("/naukri/connect/start")
async def start_naukri_browser_connect(user_id: str = Depends(get_current_user_id)):
    status = start_naukri_connect(user_id)
    return {"success": True, "portal": "naukri", "connection": status}


@router.get("/naukri/connect/status")
async def get_naukri_browser_connect_status(
    connection_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    status = get_naukri_connect_status(user_id, connection_id)
    return {"success": True, "portal": "naukri", "connection": status}


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
        "portal, profile_id, chrome_profile_path, bearer_token, expires_at, "
        "username, password_encrypted, created_at"
    ).eq("user_id", user_id).execute()
    portal_rows = await asyncio.to_thread(_decorate_portal_statuses, tokens.data or [], user_id)

    company_accounts = db.table("company_accounts").select(
        "company_key, company_name, username, account_status"
    ).eq("user_id", user_id).execute()

    return {
        "portals": {row["portal"]: row for row in portal_rows},
        "company_accounts": company_accounts.data or [],
    }


def _decorate_portal_statuses(rows: list[dict], user_id: str) -> list[dict]:
    secret_keys = {"bearer_token", "password_encrypted"}
    decorated = []
    for row in rows:
        safe_row = {key: value for key, value in row.items() if key not in secret_keys}
        safe_row["has_credentials"] = bool(row.get("password_encrypted") and row.get("username"))
        safe_row.setdefault("connection_status", "connected")
        safe_row.setdefault("requires_reconnect", False)
        safe_row.setdefault("status_message", "Connected.")
        safe_row["last_checked_at"] = _now()

        if row.get("portal") == "naukri":
            safe_row.update(_check_naukri_status(row, user_id))

        decorated.append(safe_row)
    return decorated


def _check_naukri_status(row: dict, user_id: str) -> dict:
    return naukri_status(row)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
