from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client

from core.config import SUPABASE_ANON_KEY, SUPABASE_URL

router = APIRouter()
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


class AuthIn(BaseModel):
    email: str
    password: str
    full_name: str | None = None


@router.post("/login")
async def login(body: AuthIn):
    try:
        result = supabase.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })
        return {
            "access_token": result.session.access_token,
            "user_id": result.user.id,
            "email": result.user.email,
        }
    except Exception as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


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
        }
        if result.session:
            payload.update({
                "access_token": result.session.access_token,
                "email": result.user.email if result.user else body.email,
            })
        return payload
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
