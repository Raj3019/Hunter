from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client

from core.config import SUPABASE_ANON_KEY, SUPABASE_URL
from core.auth import get_current_user_id
from core.database import NULL_RESULT, get_db

router = APIRouter()
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


class AuthIn(BaseModel):
    email: str
    password: str
    full_name: str | None = None


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None


def _profile_payload(user_id: str, email: str | None = None, fallback_full_name: str = "") -> dict:
    db = get_db()
    result = db.table("profiles").select("id, email, full_name, phone").eq("id", user_id).maybe_single().execute() or NULL_RESULT
    row = result.data or {}
    return {
        "user_id": user_id,
        "email": row.get("email") or email or "",
        "full_name": row.get("full_name") or fallback_full_name or "",
        "phone": row.get("phone") or "",
    }


@router.post("/login")
async def login(body: AuthIn):
    try:
        result = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        profile = _profile_payload(result.user.id, result.user.email)
        return {
            "access_token": result.session.access_token,
            **profile,
        }
    except Exception as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@router.get("/me")
async def me(user_id: str = Depends(get_current_user_id)):
    return _profile_payload(user_id)


@router.patch("/me")
async def update_me(body: ProfileUpdate, user_id: str = Depends(get_current_user_id)):
    updates = {}
    if body.full_name is not None:
        full_name = body.full_name.strip()
        if not full_name:
            raise HTTPException(status_code=400, detail="Full name is required")
        updates["full_name"] = full_name
    if body.phone is not None:
        updates["phone"] = body.phone.strip() or None

    if updates:
        db = get_db()
        db.table("profiles").update(updates).eq("id", user_id).execute()
    return _profile_payload(user_id)


@router.post("/register")
async def register(body: AuthIn):
    try:
        metadata = {}
        if body.full_name and body.full_name.strip():
            metadata["full_name"] = body.full_name.strip()
            metadata["name"] = body.full_name.strip()

        result = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {"data": metadata} if metadata else {},
        })
        payload = {
            "message": "Check your email for a confirmation link",
            "user_id": result.user.id if result.user else None,
            "email": result.user.email if result.user else body.email,
            "full_name": metadata.get("full_name", ""),
        }
        if result.session:
            profile = _profile_payload(result.user.id, result.user.email if result.user else body.email, metadata.get("full_name", ""))
            payload.update({
                "access_token": result.session.access_token,
                **profile,
            })
        return payload
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
