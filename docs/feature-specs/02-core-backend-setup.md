# Feature Spec 02 — Core Backend Setup

## What This Is

The foundational layer of the FastAPI backend: project structure, environment config, Supabase database client, AES-256 encryption utility, and the main FastAPI app with CORS and router mounting. Everything else is built on top of this.

## Prerequisites

- `01-database-schema.md` complete (Supabase tables exist)
- Python 3.11 installed
- `.env` file with Supabase keys and encryption key

## Environment Variables Needed

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ENCRYPTION_KEY=         # generate this — see Step 2
ANTHROPIC_API_KEY=your-claude-api-key
FRONTEND_URL=http://localhost:3000
```

---

## Implementation Steps

### Step 1 — Install Dependencies

```bash
pip install fastapi uvicorn httpx requests python-dotenv supabase cryptography anthropic apscheduler fake-useragent pdfplumber pypdf python-docx playwright twilio resend
playwright install chromium
```

Save to `backend/requirements.txt`:

```
fastapi==0.115.0
uvicorn==0.30.0
httpx==0.27.0
requests==2.32.0
python-dotenv==1.0.0
supabase==2.5.0
cryptography==42.0.0
anthropic==0.34.0
apscheduler==3.10.4
fake-useragent==1.5.1
pdfplumber==0.11.0
pypdf==4.3.0
python-docx==1.1.2
playwright==1.45.0
twilio==9.3.0
resend==2.3.0
```

---

### Step 2 — Generate Encryption Key (one-time)

Run this once and save the output to `.env` as `ENCRYPTION_KEY`:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

**Never regenerate this key after any passwords have been saved** — existing encrypted values become permanently unreadable.

---

### Step 3 — `backend/core/config.py`

```python
# backend/core/config.py
import os
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

_required = [
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "ENCRYPTION_KEY", "ANTHROPIC_API_KEY"
]
for var in _required:
    if not os.getenv(var):
        raise RuntimeError(f"Missing required environment variable: {var}")
```

---

### Step 4 — `backend/core/database.py`

```python
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
```

---

### Step 5 — `backend/core/encryption.py`

```python
# backend/core/encryption.py
from cryptography.fernet import Fernet
from core.config import ENCRYPTION_KEY

_fernet: Fernet = None

def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        if not ENCRYPTION_KEY:
            raise RuntimeError("ENCRYPTION_KEY not set in environment")
        _fernet = Fernet(ENCRYPTION_KEY.encode())
    return _fernet

def encrypt(plain_text: str) -> str:
    return _get_fernet().encrypt(plain_text.encode()).decode()

def decrypt(encrypted_text: str) -> str:
    return _get_fernet().decrypt(encrypted_text.encode()).decode()
```

**Rules enforced by this module:**
- Only ever call `decrypt()` at the exact point of use (Playwright `page.fill()`)
- Delete the result immediately after use: `del plain_password`
- Never pass the decrypted value to any logger, API response, or other function

---

### Step 6 — `backend/core/auth.py` (JWT verification helper)

```python
# backend/core/auth.py
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
```

Usage in any route:
```python
from core.auth import get_current_user_id
from fastapi import Depends

@router.get("/me")
async def get_me(user_id: str = Depends(get_current_user_id)):
    ...
```

---

### Step 7 — `backend/main.py`

```python
# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import FRONTEND_URL

app = FastAPI(title="Hunter API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers — added as each feature spec is implemented
# from api.routes import auth, resume, preferences, jobs, applications, portals, company_accounts
# app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
# app.include_router(resume.router, prefix="/api/resume", tags=["resume"])
# ...

@app.get("/health")
async def health():
    return {"status": "ok"}
```

---

### Step 8 — Run the Server

```bash
cd backend
uvicorn main:app --reload --port 8000
```

---

## Testing

### Test 1 — Server Starts

```
Expected: uvicorn prints "Application startup complete" with no errors
Fail signal: RuntimeError about missing env var → check .env
```

### Test 2 — Health Endpoint

```bash
curl http://localhost:8000/health
# Expected: {"status":"ok"}
```

### Test 3 — Encryption Round-Trip

```python
# test_encryption.py
from core.encryption import encrypt, decrypt

original = "my_secret_password_123"
encrypted = encrypt(original)
assert encrypted != original
assert "my_secret" not in encrypted

decrypted = decrypt(encrypted)
assert decrypted == original
print("Encryption round-trip: PASS")

# Verify same input produces different ciphertext each time (Fernet uses random IV)
encrypted2 = encrypt(original)
assert encrypted != encrypted2
print("Unique ciphertext per call: PASS")
```

```bash
cd backend && python test_encryption.py
```

### Test 4 — Database Connection

```python
# test_db_connection.py
from core.database import get_db

db = get_db()
result = db.table("jobs").select("count", count="exact").execute()
print(f"DB connection OK. Jobs in table: {result.count}")
```

### Test 5 — Auth Header Rejection

```bash
curl http://localhost:8000/api/resume/parsed
# Expected: 422 Unprocessable Entity (missing Authorization header)

curl -H "Authorization: Bearer invalid_token" http://localhost:8000/api/resume/parsed
# Expected: 401 Invalid or expired token
```

---

## Expected Success Behaviour

- `uvicorn main:app --reload` starts with no errors
- `GET /health` returns `{"status": "ok"}`
- `test_encryption.py` prints both PASS lines
- `test_db_connection.py` prints job count (0 at this stage)
- A request without a valid JWT returns 401

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `RuntimeError: Missing required environment variable: ENCRYPTION_KEY` | `.env` not loaded or key missing | Ensure `.env` is in `backend/` directory and contains the key |
| `ModuleNotFoundError: No module named 'supabase'` | pip install not run | Run `pip install -r requirements.txt` |
| `cryptography.fernet.InvalidToken` on decrypt | Wrong key or corrupted value | Verify `ENCRYPTION_KEY` in `.env` matches the one used when encrypting |
| CORS error in browser | `FRONTEND_URL` mismatch | Set `FRONTEND_URL=http://localhost:3000` in `.env` |
| `connection refused` on Supabase client | Wrong `SUPABASE_URL` format | Must be `https://xxx.supabase.co` — no trailing slash |

## Challenges

- **Key management**: The `ENCRYPTION_KEY` must never change after first use. Store it somewhere safe (AWS Secrets Manager in production) and document that regenerating it invalidates all stored company portal passwords.
- **Two Supabase clients**: Using the service role key bypasses RLS — it can read/write any user's data. Only use it in the backend scheduler and server-to-server writes. The anon key + user JWT must be used for any user-initiated action so RLS protects the data.
- **`get_current_user_id` dependency overhead**: Supabase's `get_user(token)` makes a network call on every request. For high-traffic routes, consider caching the decoded JWT locally using PyJWT instead of making a network round-trip.
