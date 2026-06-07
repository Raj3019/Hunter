import hashlib
import time
from threading import Lock

from fastapi import HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import create_client
from core.config import SUPABASE_URL, SUPABASE_ANON_KEY

bearer_scheme = HTTPBearer()

# Verifying every request against Supabase Auth is a network round-trip. Cache a
# successful token -> user_id mapping for a short window so a burst of requests
# from one session does not hit Supabase each time. The token is hashed so the
# raw bearer never sits in memory. A revoked token stays valid for at most the
# TTL, which is an acceptable trade-off for the latency saved.
_TOKEN_TTL_SECONDS = 30
_MAX_CACHE_ENTRIES = 1024
_token_cache: dict[str, tuple[str, float]] = {}
_cache_lock = Lock()


def _cache_key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Security(bearer_scheme),
) -> str:
    token = credentials.credentials
    key = _cache_key(token)
    now = time.monotonic()

    with _cache_lock:
        cached = _token_cache.get(key)
        if cached and cached[1] > now:
            return cached[0]

    try:
        client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        user = client.auth.get_user(token)
        user_id = user.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    with _cache_lock:
        if len(_token_cache) >= _MAX_CACHE_ENTRIES:
            _token_cache.clear()
        _token_cache[key] = (user_id, now + _TOKEN_TTL_SECONDS)
    return user_id
