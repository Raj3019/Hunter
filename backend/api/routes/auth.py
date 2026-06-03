from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client

from core.config import SUPABASE_ANON_KEY, SUPABASE_URL

router = APIRouter()
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


class AuthIn(BaseModel):
    email: str
    password: str


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
        result = supabase.auth.sign_up({
            "email": body.email,
            "password": body.password,
        })
        return {
            "message": "Check your email for a confirmation link",
            "user_id": result.user.id if result.user else None,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
