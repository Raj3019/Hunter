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
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

_required = [
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "ENCRYPTION_KEY"
]
for var in _required:
    if not os.getenv(var):
        raise RuntimeError(f"Missing required environment variable: {var}")

if AI_PROVIDER not in ("anthropic", "openrouter"):
    raise RuntimeError("AI_PROVIDER must be 'anthropic' or 'openrouter'")
