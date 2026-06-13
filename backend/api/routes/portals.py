import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.auth import get_current_user_id
from core.database import get_db
from core.encryption import encrypt
from portals.foundit.session import (
    foundit_status,
    login_with_foundit_credentials,
    set_auth_failed as set_foundit_auth_failed,
)
from portals.career_portals import (
    career_status,
    is_career_portal,
    set_career_auth_failed,
    verify_login as verify_career_login,
)
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


class FounditCredentialsIn(BaseModel):
    username: str
    password: str


class CareerCredentialsIn(BaseModel):
    username: str
    password: str


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


@router.post("/foundit/credentials")
async def save_foundit_credentials(
    body: FounditCredentialsIn,
    user_id: str = Depends(get_current_user_id),
):
    """Connect Foundit with credentials for a durable, auto-refreshing session.

    The password is validated with a live login, encrypted immediately, and never
    returned. Durable credentials are required for unattended applied-status sync,
    since Foundit's bearer token lapses and the public search needs no login.
    """
    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(status_code=400, detail="Enter your Foundit email and password.")

    try:
        session = await asyncio.to_thread(
            login_with_foundit_credentials, username, body.password,
        )
    except Exception as exc:
        logger.warning("Foundit credential login failed for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=400,
            detail="Could not sign in to Foundit with those credentials. Check your email/password and try again.",
        ) from exc

    encrypted = encrypt(body.password)
    body.password = ""

    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "foundit",
        "bearer_token": session["bearer_token"],
        "profile_id": session.get("profile_id") or None,
        "username": username,
        "password_encrypted": encrypted,
    }, on_conflict="user_id,portal").execute()
    set_foundit_auth_failed(db, user_id, False)

    return {"success": True, "portal": "foundit", "username": username}


@router.delete("/foundit")
async def disconnect_foundit(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("portal_tokens").delete().eq("user_id", user_id).eq("portal", "foundit").execute()
    return {"success": True, "portal": "foundit", "disconnected": True}


@router.post("/{portal_key}/credentials")
async def save_career_credentials(
    portal_key: str,
    body: CareerCredentialsIn,
    user_id: str = Depends(get_current_user_id),
):
    """Connect a company career portal (Wipro/HCLTech/Infosys) with encrypted credentials.

    The password is validated with a live login, encrypted immediately, and never
    returned. The stored login powers unattended applied-status auto-detection.
    """
    if not is_career_portal(portal_key):
        raise HTTPException(status_code=404, detail="Unknown career portal.")

    username = body.username.strip()
    if not username or not body.password:
        raise HTTPException(
            status_code=400,
            detail=f"Enter your {portal_key.title()} careers email and password.",
        )

    try:
        await asyncio.to_thread(verify_career_login, portal_key, username, body.password)
    except Exception as exc:
        logger.warning("%s credential login failed for user %s: %s", portal_key, user_id, exc)
        raise HTTPException(
            status_code=400,
            detail=(
                f"Could not sign in to {portal_key.title()} careers with those credentials. "
                "Check your email/password and try again."
            ),
        ) from exc

    encrypted = encrypt(body.password)
    body.password = ""

    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": portal_key,
        "username": username,
        "password_encrypted": encrypted,
    }, on_conflict="user_id,portal").execute()
    set_career_auth_failed(db, user_id, portal_key, False)

    return {"success": True, "portal": portal_key, "username": username}


@router.delete("/career/{portal_key}")
async def disconnect_career(portal_key: str, user_id: str = Depends(get_current_user_id)):
    if not is_career_portal(portal_key):
        raise HTTPException(status_code=404, detail="Unknown career portal.")
    db = get_db()
    db.table("portal_tokens").delete().eq("user_id", user_id).eq("portal", portal_key).execute()
    return {"success": True, "portal": portal_key, "disconnected": True}


@router.get("/status")
async def get_portal_status(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    tokens = db.table("portal_tokens").select(
        "portal, profile_id, chrome_profile_path, bearer_token, expires_at, "
        "username, password_encrypted, auth_failed_at, created_at"
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
        elif row.get("portal") == "foundit":
            safe_row.update(foundit_status(row))
        elif is_career_portal(row.get("portal", "")):
            safe_row.update(career_status(row))

        decorated.append(safe_row)
    return decorated


def _check_naukri_status(row: dict, user_id: str) -> dict:
    return naukri_status(row)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
