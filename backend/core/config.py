import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
AI_PROVIDER = os.getenv("AI_PROVIDER", "anthropic").lower()
AI_MODEL = os.getenv("AI_MODEL") or (
    os.getenv("OPENROUTER_MODEL") if AI_PROVIDER == "openrouter" else "claude-sonnet-4-20250514"
)


def _normalize_origin(value: str | None) -> str | None:
    if not value:
        return None
    origin = value.strip().rstrip("/")
    return origin or None


def _csv_origins(value: str | None) -> list[str]:
    origins: list[str] = []
    for item in (value or "").split(","):
        origin = _normalize_origin(item)
        if origin and origin not in origins:
            origins.append(origin)
    return origins


_DEV_FRONTEND_ORIGINS = ("http://localhost:3000", "http://127.0.0.1:3000")
FRONTEND_URL = _normalize_origin(os.getenv("FRONTEND_URL")) or _DEV_FRONTEND_ORIGINS[0]
_configured_frontend_origins = _csv_origins(os.getenv("FRONTEND_ORIGINS"))
FRONTEND_ORIGINS = [FRONTEND_URL]
if _configured_frontend_origins:
    FRONTEND_ORIGINS.extend(_configured_frontend_origins)
elif FRONTEND_URL in _DEV_FRONTEND_ORIGINS:
    FRONTEND_ORIGINS.extend(_DEV_FRONTEND_ORIGINS)
FRONTEND_ORIGINS = list(dict.fromkeys(FRONTEND_ORIGINS))

_required = [
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "ENCRYPTION_KEY"
]
for var in _required:
    if not os.getenv(var):
        raise RuntimeError(f"Missing required environment variable: {var}")

if AI_PROVIDER not in ("anthropic", "openrouter"):
    raise RuntimeError("AI_PROVIDER must be 'anthropic' or 'openrouter'")
