# Feature Spec 13 — FastAPI Route Handlers

## What This Is

All FastAPI HTTP route handlers organised by domain. Each router is thin: validate input → call service/portal/AI → persist to DB → return response. No business logic lives inline in handlers. Covers auth, resume, preferences, jobs (matches + apply), applications (tracker), and portals (token management).

## Prerequisites

- `02-core-backend-setup.md` complete
- `01-database-schema.md` complete
- `10-ai-layer.md` complete (resume_parser)
- `11-safe-apply-manager.md` complete
- Supabase Storage bucket `resumes` created

---

## Route Map

```
POST   /api/auth/login               Sign in → return JWT
POST   /api/auth/register            Sign up → create profile

POST   /api/resume/upload            Upload PDF → parse → save
GET    /api/resume/parsed            Get latest parsed resume

POST   /api/preferences              Save/update job preferences
GET    /api/preferences              Get current preferences

POST   /api/portals/naukri/token     Save Naukri Bearer token
POST   /api/portals/foundit/token    Save Foundit Bearer token
POST   /api/portals/linkedin/setup   Confirm LinkedIn Chrome profile ready
GET    /api/portals/status           All portal connection states

GET    /api/jobs/matches             Today's scored job matches
POST   /api/jobs/{id}/approve        Mark match as approved (eligible for manual/auto apply)
POST   /api/jobs/{id}/skip           Mark match as skipped
POST   /api/jobs/{id}/tailor         Generate tailored resume draft artifact for a match
POST   /api/jobs/{id}/tailor/approve Approve a generated tailored resume draft for the next apply
POST   /api/jobs/{id}/apply          Manual Apply now for an approved job

GET    /api/applications             All application records
PATCH  /api/applications/{id}        Update status manually

POST   /api/admin/trigger-fetch      Admin-only manual scheduler trigger
```

---

## MVP Live Flow Contracts

- `POST /api/preferences` stores both matching preferences and apply settings: `auto_apply_enabled`, `auto_apply_daily_limit`, `auto_apply_min_score`, `auto_apply_allowed_portals`, `safe_apply_start_time`, `safe_apply_end_time`, and `require_tailored_resume_approval`.
- `POST /api/jobs/{id}/apply` is Manual Apply now by default. It must run pre-apply checks and submit immediately if blockers are clear; it must not add random SafeApplyManager delay.
- Auto-apply should run from scheduler/runner code using approved matches and user apply settings. It uses SafeApplyManager throttling and writes the same application audit records.
- `POST /api/jobs/{id}/tailor` generates structured tailoring output plus a per-job draft resume artifact. It inserts a `tailored_resumes` row with `status='draft'` and returns the draft id, version, file URL, tailoring JSON, and validation JSON.
- `POST /api/jobs/{id}/tailor/approve` must approve a real generated draft id. It marks the `tailored_resumes` row `approved`, copies its file URL/version to `job_matches`, and makes that artifact eligible for manual Apply now or auto-apply. Empty URL approvals are invalid.
- Application records must capture `apply_mode`, `pre_apply_check`, `portal_response`, `resume_version`, `blocked_reason`, and `failed_reason` where available.
- Backend and frontend must share these application statuses: `approved`, `applied`, `viewed`, `interview`, `offer`, `rejected`, `archived`, `blocked`, `failed`, `needs_review`.
- `/api/admin/trigger-fetch` must require a valid JWT plus an admin authorization check before invoking the scheduler.

### Tailored Resume API Contract

Tailoring creates a draft artifact for one job match; it does not mutate the user's base resume.

`POST /api/jobs/{id}/tailor` response:

```json
{
  "success": true,
  "tailored": {
    "tailored_summary": "",
    "reordered_skills": [],
    "highlighted_experience": [],
    "changes_made": [],
    "warnings": ""
  },
  "draft": {
    "id": "uuid",
    "status": "draft",
    "file_url": "https://...",
    "file_type": "docx",
    "version": "tailored:2026-06-04T10:30:00Z",
    "validation": {
      "ok": true,
      "blocked_claims": [],
      "warnings": []
    }
  }
}
```

`POST /api/jobs/{id}/tailor/approve` request:

```json
{
  "tailored_resume_id": "uuid"
}
```

Rules:

- Approve must fail if the draft does not belong to the authenticated user and match.
- Approve must fail if validation has hard blockers.
- Apply routes must use only approved tailored artifacts. Draft artifacts stay review-only.
- `applications.resume_version` and `applications.tailored_resume_url` must record the exact artifact used.

## Implementation Steps

### `backend/api/routes/auth.py`

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from supabase import create_client
from core.config import SUPABASE_URL, SUPABASE_ANON_KEY

router = APIRouter()
supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

class AuthIn(BaseModel):
    email: EmailStr
    password: str

@router.post("/login")
async def login(body: AuthIn):
    try:
        result = supabase.auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
        return {
            "access_token": result.session.access_token,
            "user_id": result.user.id,
            "email": result.user.email,
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e))

@router.post("/register")
async def register(body: AuthIn):
    try:
        result = supabase.auth.sign_up(
            {"email": body.email, "password": body.password}
        )
        return {"message": "Check your email for a confirmation link", "user_id": result.user.id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
```

---

### `backend/api/routes/resume.py`

```python
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from core.auth import get_current_user_id
from core.database import get_db
from ai.resume_parser import parse_resume
import tempfile, os

router = APIRouter()

@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id)
):
    if file.content_type not in ("application/pdf",):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    if file.size and file.size > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large — max 10MB")

    db = get_db()

    # Save to temp file for parsing
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Parse with AI
        parsed = await parse_resume(tmp_path)

        # Upload to Supabase Storage
        storage_path = f"{user_id}/{file.filename}"
        db.storage.from_("resumes").upload(
            storage_path, content, {"content-type": "application/pdf", "upsert": "true"}
        )
        file_url = db.storage.from_("resumes").get_public_url(storage_path)

        # Save to DB
        db.table("resumes").upsert({
            "user_id": user_id,
            "file_url": file_url,
            "parsed_data": parsed,
            "raw_text": open(tmp_path).read()[:50000],  # store first 50k chars
        }, on_conflict="user_id").execute()

        return {"success": True, "parsed": parsed}

    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    finally:
        os.unlink(tmp_path)

@router.get("/parsed")
async def get_parsed_resume(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("resumes").select(
        "parsed_data, file_url, created_at"
    ).eq("user_id", user_id).order("created_at", desc=True).limit(1).maybe_single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="No resume found — please upload first")
    return result.data
```

---

### `backend/api/routes/preferences.py`

```python
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import List, Optional
from core.auth import get_current_user_id
from core.database import get_db

router = APIRouter()

class PreferencesIn(BaseModel):
    job_titles: List[str] = []
    locations: List[str] = []
    work_type: List[str] = []      # 'remote', 'hybrid', 'onsite'
    min_salary: Optional[int] = 0
    max_salary: Optional[int] = 0
    experience_years: Optional[int] = 0
    avoid_companies: List[str] = []

@router.post("")
async def save_preferences(body: PreferencesIn, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("preferences").upsert({
        "user_id": user_id,
        **body.dict(),
        "updated_at": "now()",
    }, on_conflict="user_id").execute()
    return {"success": True}

@router.get("")
async def get_preferences(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("preferences").select("*").eq("user_id", user_id).maybe_single().execute()
    return result.data or {}
```

---

### `backend/api/routes/portals.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core.auth import get_current_user_id
from core.database import get_db

router = APIRouter()

class NaukriTokenIn(BaseModel):
    bearer_token: str
    profile_id: str

class FounditTokenIn(BaseModel):
    bearer_token: str
    user_id_str: str

@router.post("/naukri/token")
async def save_naukri_token(body: NaukriTokenIn, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "naukri",
        "bearer_token": body.bearer_token,
        "profile_id": body.profile_id,
    }, on_conflict="user_id,portal").execute()
    return {"success": True, "portal": "naukri"}

@router.post("/foundit/token")
async def save_foundit_token(body: FounditTokenIn, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "foundit",
        "bearer_token": body.bearer_token,
        "profile_id": body.user_id_str,
    }, on_conflict="user_id,portal").execute()
    return {"success": True, "portal": "foundit"}

@router.post("/linkedin/setup")
async def confirm_linkedin_setup(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "linkedin",
        "chrome_profile_path": f"./chrome_profiles/linkedin",
    }, on_conflict="user_id,portal").execute()
    return {"success": True, "portal": "linkedin"}

@router.get("/status")
async def get_portal_status(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    tokens = db.table("portal_tokens").select(
        "portal, profile_id, chrome_profile_path, created_at"
        # bearer_token deliberately excluded
    ).eq("user_id", user_id).execute()

    company_accounts = db.table("company_accounts").select(
        "company_key, company_name, username, account_status"
    ).eq("user_id", user_id).execute()

    return {
        "portals": {row["portal"]: row for row in (tokens.data or [])},
        "company_accounts": company_accounts.data or [],
    }
```

---

### `backend/api/routes/jobs.py`

MVP update: the sample below must be adapted before implementation. `apply_to_job()` is Manual Apply now by default and should run pre-apply checks plus the portal apply immediately in the background without random delay. Auto-apply should use a separate scheduler/runner path that calls SafeApplyManager throttling and delay. Tailored resume approval now requires a generated `tailored_resumes` draft artifact; `/tailor` must create the draft file and metadata, and `/tailor/approve` must approve a real draft id before apply uses it.

```python
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from core.auth import get_current_user_id
from core.database import get_db
from portals.base import SafeApplyManager
from ai.resume_tailor import tailor_resume

router = APIRouter()

@router.get("/matches")
async def get_job_matches(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("job_matches").select(
        "*, jobs(*)"
    ).eq("user_id", user_id).eq("status", "pending").order(
        "match_score", desc=True
    ).limit(50).execute()
    return {"matches": result.data or []}

@router.post("/{match_id}/approve")
async def approve_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("job_matches").update(
        {"status": "approved"}
    ).eq("id", match_id).eq("user_id", user_id).execute()
    return {"success": True, "status": "approved"}

@router.post("/{match_id}/skip")
async def skip_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("job_matches").update(
        {"status": "skipped"}
    ).eq("id", match_id).eq("user_id", user_id).execute()
    return {"success": True, "status": "skipped"}

@router.post("/{match_id}/tailor")
async def tailor_for_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()

    # Load match + job data
    match = db.table("job_matches").select("*, jobs(*)").eq("id", match_id).eq(
        "user_id", user_id
    ).maybe_single().execute()
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    # Load resume
    resume_data = db.table("resumes").select(
        "parsed_data, raw_text"
    ).eq("user_id", user_id).order("created_at", desc=True).limit(1).maybe_single().execute()
    if not resume_data.data:
        raise HTTPException(status_code=404, detail="No resume found — upload first")

    job = match.data["jobs"]
    tailored = await tailor_resume(
        original_text=resume_data.data.get("raw_text", ""),
        resume_parsed=resume_data.data.get("parsed_data", {}),
        job_description=job.get("description", ""),
        job_title=job.get("title", ""),
    )

    # Implementation requirement:
    # 1. Validate tailored output against the original resume.
    # 2. Generate a DOCX draft with python-docx.
    # 3. Upload it to Supabase Storage.
    # 4. Insert tailored_resumes(status='draft').
    # 5. Return both tailored JSON and draft metadata.
    draft = create_tailored_resume_draft(
        user_id=user_id,
        match=match.data,
        resume=resume_data.data,
        tailored=tailored,
    )
    return {"success": True, "tailored": tailored, "draft": draft}

@router.post("/{match_id}/apply")
async def apply_to_job(
    match_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id)
):
    db = get_db()

    match = db.table("job_matches").select("*, jobs(*)").eq("id", match_id).eq(
        "user_id", user_id
    ).eq("status", "approved").maybe_single().execute()

    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found or not approved")

    # Run apply in background so request returns immediately
    background_tasks.add_task(_run_manual_apply, user_id, match.data)
    return {"success": True, "message": "Apply started — check Tracker for result"}


async def _run_manual_apply(user_id: str, match_data: dict):
    from portals.base import SafeApplyManager
    from portals.naukri.jobs import Job
    db = get_db()
    manager = SafeApplyManager()

    job_data = match_data["jobs"]
    portal = job_data["portal"]

    # Build Job object
    job = Job(
        job_id=job_data["job_id"],
        title=job_data["title"],
        company=job_data["company"],
        location=job_data["location"],
        experience=job_data.get("experience", ""),
        salary=job_data.get("salary", ""),
        posted_date=job_data.get("posted_date", ""),
        apply_link=job_data["apply_link"],
        description=job_data.get("description", ""),
        portal=portal,
    )

    # Manual Apply now uses quick pre-apply checks, not time-window delay.
    checks = pre_apply_checks(user_id=user_id, match_data=match_data, job=job)
    if not checks["ok"]:
        result = {
            "success": False,
            "blocked": True,
            "reason": checks["reason"],
            "apply_mode": "manual",
            "pre_apply_check": checks,
        }
        manager.log_application(user_id, job, result)
        db.table("job_matches").update(
            {"status": checks.get("status", "blocked")}
        ).eq("id", match_data["id"]).execute()
        return

    resolved_resume_path = resolve_resume_artifact(user_id=user_id, match_data=match_data)

    # Load user profile for Q&A
    resume_row = db.table("resumes").select("parsed_data").eq("user_id", user_id).order(
        "created_at", desc=True
    ).limit(1).maybe_single().execute()
    user_profile = resume_row.data.get("parsed_data", {}) if resume_row.data else {}

    # Route to correct portal
    result = {"success": False, "reason": f"No apply handler for portal: {portal}"}
    if portal == "naukri":
        token_row = db.table("portal_tokens").select("bearer_token").eq(
            "user_id", user_id).eq("portal", "naukri").maybe_single().execute()
        if token_row.data:
            from portals.naukri.auth import NaukriAuthClient
            from portals.naukri.jobs import NaukriJobClient
            auth = NaukriAuthClient()
            auth.bearer_token = token_row.data["bearer_token"]
            auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
            jc = NaukriJobClient(auth)
            result = jc.apply_job(job)
    elif portal == "linkedin":
        from portals.linkedin.apply import linkedin_easy_apply
        result = await linkedin_easy_apply(job, user_profile)
    elif portal == "workday":
        from portals.workday.apply import workday_apply
        # Resolve this from the uploaded resume or an approved tailored resume.
        # Never use a fixed path such as ./uploads/resume.pdf.
        result = await workday_apply(job, resolved_resume_path, user_profile)

    manager.log_application(user_id, job, result)
    final_status = "applied" if result.get("success") else "failed"
    manager.update_job_match_status(user_id, job.job_id, final_status)
```

---

### `backend/api/routes/applications.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core.auth import get_current_user_id
from core.database import get_db

router = APIRouter()

VALID_STATUSES = {
    "approved",
    "applied",
    "viewed",
    "interview",
    "offer",
    "rejected",
    "archived",
    "blocked",
    "failed",
    "needs_review",
}

class StatusUpdate(BaseModel):
    status: str
    notes: str = ""

@router.get("")
async def get_applications(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("applications").select(
        "*, jobs(title, company, location, portal, apply_link)"
    ).eq("user_id", user_id).order("applied_at", desc=True).execute()
    return {"applications": result.data or []}

@router.patch("/{app_id}")
async def update_application(
    app_id: str,
    body: StatusUpdate,
    user_id: str = Depends(get_current_user_id)
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(VALID_STATUSES)}"
        )
    db = get_db()
    db.table("applications").update({
        "status": body.status,
        "notes": body.notes,
        "updated_at": "now()",
    }).eq("id", app_id).eq("user_id", user_id).execute()
    return {"success": True, "status": body.status}
```

---

### Wire All Routers into `main.py`

```python
from api.routes import auth, resume, preferences, portals, jobs, applications
from api.routes import company_accounts  # from spec 09

app.include_router(auth.router,             prefix="/api/auth",             tags=["auth"])
app.include_router(resume.router,           prefix="/api/resume",           tags=["resume"])
app.include_router(preferences.router,      prefix="/api/preferences",      tags=["preferences"])
app.include_router(portals.router,          prefix="/api/portals",          tags=["portals"])
app.include_router(jobs.router,             prefix="/api/jobs",             tags=["jobs"])
app.include_router(applications.router,     prefix="/api/applications",     tags=["applications"])
app.include_router(company_accounts.router, prefix="/api/company-accounts", tags=["company-accounts"])
```

---

## Testing

```bash
# Start the server
uvicorn main:app --reload

# Register + Login
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test1234!"}'

curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test1234!"}' | jq .access_token

# Set TOKEN=<access_token from above>
TOKEN="eyJ..."

# Upload resume
curl -X POST http://localhost:8000/api/resume/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@./test_resume.pdf"

# Get parsed resume
curl http://localhost:8000/api/resume/parsed -H "Authorization: Bearer $TOKEN"

# Save preferences
curl -X POST http://localhost:8000/api/preferences \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"job_titles":["React Developer"],"locations":["Bangalore"],"experience_years":2}'

# Get portal status
curl http://localhost:8000/api/portals/status -H "Authorization: Bearer $TOKEN"

# Get job matches (after scheduler runs)
curl http://localhost:8000/api/jobs/matches -H "Authorization: Bearer $TOKEN"

# Get applications
curl http://localhost:8000/api/applications -H "Authorization: Bearer $TOKEN"
```

Check FastAPI auto-docs at: `http://localhost:8000/docs`

---

## Expected Success Behaviour

- Register → email confirmation required → login returns JWT
- Resume upload returns parsed JSON with name, skills, experience populated
- Preferences save and retrieve correctly
- Portal status returns connected portals after saving tokens
- `/api/jobs/matches` returns matches sorted by score descending
- Approve → apply returns `{"message": "Apply started"}` immediately; result in Tracker when the portal apply finishes
- Applications list returns all records with job data embedded

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `401` on all protected routes | JWT expired or malformed | Re-login to get fresh token |
| `404` on `/resume/parsed` | No resume uploaded yet | Upload a resume first |
| `400 Only PDF files accepted` | Wrong file type | Send a PDF file |
| `422 Unprocessable Entity` | Request body missing required field | Check request body against Pydantic model |
| Apply started but no result in Tracker | Background task failed before logging | Check server logs for errors in `_run_manual_apply`; every failure should create an application row with `failed_reason` |
| `status not in VALID_STATUSES` | Frontend sending wrong status string | Align frontend status values with `VALID_STATUSES` set |

## Challenges

- **Background apply task**: The apply endpoint uses `BackgroundTasks` so the HTTP response returns immediately. Manual Apply now should not wait for random SafeApplyManager delay, but portal automation can still take time. The frontend should poll `/api/applications` or use a websocket for real-time updates.
- **Error visibility**: Errors in background tasks don't surface in the HTTP response. Always log them with `logger.error()`, insert an `applications` audit row, and update `job_matches.status` to `failed`, `blocked`, or `needs_review`.
- **File handling**: The resume upload uses `tempfile.NamedTemporaryFile` to write to disk before passing to pdfplumber. Always delete the temp file in the `finally` block — even if parsing fails.
- **Raw text storage**: The `raw_text` column stores up to 50,000 chars of resume text. This is used by `tailor_resume()` so it doesn't need to re-extract the PDF each time. If the resume is longer, truncate at 50k — Claude only sees 4-6k chars anyway.
