from fastapi import HTTPException, Header
from supabase import create_client
from core.config import SUPABASE_URL, SUPABASE_ANON_KEY

async def get_current_user_id(authorization: str = Header(...)) -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")
    token = authorization.split(" ")[1]
    try:
        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        user = client.auth.get_user(token)
        return user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")