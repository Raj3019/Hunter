# backend/core/database.py
from supabase import create_client, Client
from core.config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

# Frontend-facing client — respects RLS, used with user JWT
def get_anon_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# Backend service client — bypasses RLS, used in scheduler + server-side writes
def get_service_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Singleton for service client (scheduler reuses it)
_service_client: Client = None

def get_db() -> Client:
    global _service_client
    if _service_client is None:
        _service_client = get_service_client()
    return _service_client