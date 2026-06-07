# Feature Spec 03 — Naukri Portal

## What This Is

Integration with Naukri.com using their reverse-engineered internal JSON API — the same endpoints their own browser calls. Covers login (Bearer token capture), job search (including the nkparam signature header), recommended jobs, and Easy Apply. This is the highest-priority portal and the first one to build.

Naukri browser login is optional in the MVP. Normal job search must not require login because automation-managed browser sessions can trigger repeated CAPTCHA, but the Portals page can still offer browser login for users who want to save a Naukri session.

Manual Job Search uses this portal client directly. When the user types a query in Hunter, the backend should call Naukri's normal search endpoint (`/jobapi/v3/search`) with a fresh `nkparam`, save scored matches, and skip the recommended feed unless the user explicitly asks for recommendations.

External apply rule: Naukri jobs open on the original portal in MVP. Hunter stores the raw flags in `jobs.portal_metadata`, sets `jobs.apply_method` to `external` or `unknown` when needed, and creates `external_pending` tracker tasks instead of calling the Naukri apply API.

NopeRi reference: https://github.com/Traverser25/NopeRi. Use it to compare Naukri search headers, `nkparam` behavior, and `/jobapi/v3/search` request shape when Hunter's client breaks. Keep Hunter's implementation in `backend/portals/naukri/`; do not expose tokens or browser-session data to the frontend.

## Prerequisites

- `02-core-backend-setup.md` complete
- A real Naukri account (your own) for testing
- Chrome DevTools to intercept the API calls once before coding
- `portals/naukri/` directory created inside `backend/`

## Environment Variables Needed

The guided Connect flow does not require storing Naukri credentials in `.env`; the user logs in manually in the opened browser window. The variables below are only for local test scripts that use direct API login.

```
NAUKRI_USERNAME=your_naukri_email
NAUKRI_PASSWORD=your_naukri_password
```

---

## Implementation Steps

### MVP Public Search Flow

Naukri browser login is optional in the MVP because app-managed browser sessions can trigger repeated CAPTCHA. Normal Jobs search should use the unauthenticated public Naukri search path and then open the original job URL for manual portal completion.

Runtime auth rule:

- Do not require Naukri login for search or profile-based discovery.
- Do not call the browser-profile refresh helper from portal status, scheduler fetch, or normal Jobs search.
- Show Naukri browser login as optional only; never make it a prerequisite for search.
- Treat authenticated Naukri browser work as future-only research that requires explicit approval.

Routes:

```
POST /api/portals/naukri/connect/start
GET  /api/portals/naukri/connect/status?connection_id=...
```

Security rules:

- Never return the captured Bearer token to the frontend.
- Never log the Bearer token.
- Manual token entry remains available only as an advanced fallback.
- This is a backend-managed browser flow, not a plain `window.open()` tab, because a normal browser tab cannot expose portal tokens to Hunter safely.

### Durable Authentication (Encrypted Credential Re-Login)

This is the authenticated path used when the user wants personalized recommendations and apply, and it must stay connected for days — not minutes.

#### The problem (diagnosed against live Naukri)

A Naukri login sets two tiers of cookies:

| Cookie | Lifetime | Role |
|---|---|---|
| `nauk_at` | **1 hour** (JWT, has an `exp` claim) | The Bearer token the APIs actually require |
| `nauk_rt` | **1 year** (HttpOnly) | Refresh token — the durable session |
| `nauk_sid` + others | 1 year | Session support |

The original implementation stored only `nauk_at` (the 1-hour token) in `portal_tokens.bearer_token` and **hardcoded portal status to "connected"**, never validating the token. Result: the saved login was dead within an hour (dashboard API returned 401) while the UI still claimed "Connected." Verified empirically:

- The stored token's JWT `exp` was exactly 1 hour after `iat`; the saved DB token returned dashboard **401**.
- The persistent Chrome profile retained only tracking cookies (`J`, `_t_ds`) — no `nauk_at`/`nauk_rt`/`nauk_sid`.
- Injecting the durable cookies into a profile and revisiting Naukri **reproduced the logout-wipe** down to `J`/`_t_ds`: Naukri logs the browser out the moment it hits an authenticated page with a missing `nauk_at`, purging the refresh cookie.
- No transparent refresh exchange fires on navigation or on a forced 401, so the browser profile cannot self-recover a lapsed session.

Conclusion: keeping a durable session via the browser profile is not viable, and storing only the 1-hour token can never "stay valid for days."

#### The solution

Store the user's Naukri credentials encrypted (Fernet/AES-256) and silently re-login to mint a fresh `nauk_at` whenever the cached one is missing or expired. "Natural expiry → sign in again" then means the stored credentials themselves stop working (password change / account lock / CAPTCHA), not a 1-hour timer.

- **Schema** (`migrations/006_naukri_credentials.sql`): `portal_tokens.username`, `portal_tokens.password_encrypted`; `expires_at` caches the token's JWT `exp`.
- **`portals/naukri/session.py`**:
  - `decode_jwt_exp(token)` reads the `exp` claim (no signature verification needed).
  - `login_with_credentials(username, password)` → `{bearer_token, profile_id, expires_at}`.
  - `get_valid_naukri_auth(user_id)` returns an authenticated client: reuse the cached token while live; otherwise decrypt the stored password, re-login, persist the fresh token + expiry, and `del password`. Returns `None` when there is no usable login (caller falls back to public search).
  - `naukri_status(row)` reports honest state from cached data only (no network): `connected` (token live), `connected` + "refreshes automatically" (expired token but credentials stored), or `expired` + `requires_reconnect` (dead token, no credentials).
- **Routes**:

```
POST   /api/portals/naukri/credentials   # validate via live login, encrypt password, store; never returns the password
DELETE /api/portals/naukri               # disconnect (clears the row)
```

- **Search wiring** (`services/job_discovery.py`): `_search_naukri` calls `get_valid_naukri_auth`; when connected it folds in personalized recommended jobs (only for profile/empty-query runs) and enables authed apply, with public keyword search as the fallback.

Security rules (in addition to the browser-flow rules above):

- Encrypt the password with `core/encryption.py` immediately on receipt; decrypt only at the moment of the login call, then `del`.
- Never return `bearer_token` or `password_encrypted` in any API response. `/api/portals/status` strips both and exposes only a boolean `has_credentials`.

### Step 1 — DevTools Study (Do This Before Writing Code)

1. Open Chrome → `naukri.com` → login with your account
2. Open DevTools → Network tab → filter: **Fetch/XHR**
3. Capture and record the exact details of these requests:

```
LOGIN
  URL: POST https://www.naukri.com/central-login-services/v1/login
  Request body: { "username": "...", "password": "..." }
  Response keys: look for authToken (or token), profileId (or userId)
  Note any required request headers (appid, systemid, etc.)

RECOMMENDED JOBS
  URL: GET https://www.naukri.com/recommended-jobs-service/v1/reco
  Headers: Authorization: Bearer <token>
  Response: look for jobDetails or jobs array

JOB SEARCH
  URL: GET https://www.naukri.com/jobapi/v3/search
  Headers: nkparam: <some-token>, Authorization: Bearer <token>
  Params: keyword, location, experience, pageNo, noOfResults
  Response: look for jobDetails array structure

EASY APPLY
  URL: POST https://www.naukri.com/apply-service/v1/apply
  Body: { "jobId": "..." }
  Headers: Authorization: Bearer <token>
```

Write down the exact field names from the responses — they change over time and the implementation must match.

---

### Step 2 — `backend/portals/naukri/auth.py`

```python
import requests
from dataclasses import dataclass
from typing import Optional

NAUKRI_BASE = "https://www.naukri.com"

BASE_HEADERS = {
    "Content-Type": "application/json",
    "appid": "109",
    "systemid": "Naukri",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
}

@dataclass
class NaukriSession:
    bearer_token: str
    profile_id: str
    username: str

class NaukriAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(BASE_HEADERS)
        self.bearer_token: Optional[str] = None
        self.profile_id: Optional[str] = None

    def login(self, username: str, password: str) -> NaukriSession:
        url = f"{NAUKRI_BASE}/central-login-services/v1/login"
        response = self.session.post(url, json={"username": username, "password": password})
        response.raise_for_status()
        data = response.json()

        # Try multiple possible key names — Naukri has changed these before
        self.bearer_token = (
            data.get("authToken") or
            data.get("token") or
            data.get("bearerToken")
        )
        self.profile_id = (
            data.get("profileId") or
            data.get("userId") or
            data.get("id")
        )

        if not self.bearer_token:
            raise ValueError(f"Login failed — no token in response. Keys: {list(data.keys())}")

        self.session.headers.update({"Authorization": f"Bearer {self.bearer_token}"})
        return NaukriSession(self.bearer_token, self.profile_id, username)

    def upload_resume(self, pdf_path: str) -> dict:
        url = f"{NAUKRI_BASE}/profile-update-services/v1/user/{self.profile_id}/resume"
        with open(pdf_path, "rb") as f:
            response = self.session.post(
                url, files={"resume": (pdf_path.split("/")[-1], f, "application/pdf")}
            )
        return response.json()
```

---

### Step 3 — `backend/portals/naukri/nkparam.py`

nkparam is an encrypted signature header required by the job search API. Without it, you get 403.

**Option A — Playwright interception (recommended for MVP, always works):**

```python
from playwright.async_api import async_playwright
import asyncio

async def capture_nkparam(keyword: str = "developer") -> str:
    captured = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="./chrome_profiles/naukri",
            headless=False
        )
        page = await browser.new_page()

        async def on_request(request):
            if "jobapi/v3/search" in request.url:
                nk = request.headers.get("nkparam")
                if nk:
                    captured["nkparam"] = nk

        page.on("request", on_request)

        # Navigate to search page — this triggers the API call with nkparam
        await page.goto(f"https://www.naukri.com/{keyword.replace(' ', '-')}-jobs")
        await asyncio.sleep(5)
        await browser.close()

    if not captured.get("nkparam"):
        raise RuntimeError("Could not capture nkparam — is the browser logged in?")
    return captured["nkparam"]
```

**Note on Option B (native generation):** Study the `nkparam_generator.py` from the NopeRi reference repo at github.com/Traverser25/NopeRi to understand the algorithm. If you implement it, it eliminates the need to launch a browser just for job search — significantly faster. Start with Playwright interception for MVP and replace later.

---

### Step 4 — `backend/portals/naukri/jobs.py`

```python
import time
import random
from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class Job:
    job_id: str
    title: str
    company: str
    location: str
    experience: str
    salary: str
    posted_date: str
    apply_link: str
    description: str
    portal: str = "naukri"
    tags: List[str] = field(default_factory=list)
    has_questionnaire: bool = False
    is_workday: bool = False
    is_taleo: bool = False

class NaukriJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def get_recommended_jobs(self) -> List[Job]:
        url = "https://www.naukri.com/recommended-jobs-service/v1/reco"
        response = self.session.get(url)
        response.raise_for_status()
        return self._parse_jobs(response.json())

    async def search_jobs(
        self, keyword: str, location: str = "",
        experience: int = 0, page: int = 1
    ) -> List[Job]:
        from .nkparam import capture_nkparam
        nkparam = await capture_nkparam(keyword)

        url = "https://www.naukri.com/jobapi/v3/search"
        params = {
            "noOfResults": 20,
            "urlType": "search_by_keyword",
            "searchType": "adv",
            "keyword": keyword,
            "location": location,
            "experience": experience,
            "pageNo": page,
        }
        response = self.session.get(url, params=params, headers={"nkparam": nkparam})
        response.raise_for_status()
        return self._parse_jobs(response.json())

    def apply_job(self, job: Job) -> dict:
        if job.has_questionnaire:
            return {"success": False, "reason": f"Questionnaire required — skip: {job.title}"}

        url = "https://www.naukri.com/apply-service/v1/apply"
        payload = {"jobId": job.job_id}
        response = self.session.post(url, json=payload)

        # Human-like delay — mandatory after every apply
        time.sleep(random.uniform(30, 90))
        return response.json()

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = data.get("jobDetails") or data.get("jobs") or []
        for item in items:
            raw_tags = item.get("tagsAndSkills", "")
            tags = [t.strip() for t in raw_tags.split(",") if t.strip()] if raw_tags else []
            jobs.append(Job(
                job_id=str(item.get("jobId", "")),
                title=item.get("title", ""),
                company=item.get("companyName", ""),
                location=item.get("location", ""),
                experience=item.get("experience", ""),
                salary=item.get("salary", "Not disclosed"),
                posted_date=item.get("createdDate", ""),
                apply_link=item.get("jdURL", ""),
                description=item.get("jobDescription", ""),
                tags=tags,
            ))
        return jobs
```

---

### Step 5 — Test Script

```python
# backend/test_naukri.py
import asyncio
from portals.naukri.auth import NaukriAuthClient
from portals.naukri.jobs import NaukriJobClient
from dotenv import load_dotenv
import os

load_dotenv()

async def main():
    print("=== Naukri Portal Test ===")

    # 1. Login
    auth = NaukriAuthClient()
    session = auth.login(os.getenv("NAUKRI_USERNAME"), os.getenv("NAUKRI_PASSWORD"))
    assert session.bearer_token, "No bearer token"
    assert session.profile_id, "No profile ID"
    print(f"[PASS] Login — token: {session.bearer_token[:20]}... profile: {session.profile_id}")

    jc = NaukriJobClient(auth)

    # 2. Recommended jobs
    reco = jc.get_recommended_jobs()
    assert len(reco) > 0, "No recommended jobs returned"
    print(f"[PASS] Recommended jobs — {len(reco)} returned")
    for j in reco[:2]:
        print(f"       {j.title} @ {j.company} | {j.location}")

    # 3. Job search
    jobs = await jc.search_jobs(keyword="React developer", location="Bangalore", experience=2)
    assert len(jobs) > 0, "No jobs from search"
    print(f"[PASS] Job search — {len(jobs)} returned")
    for j in jobs[:3]:
        print(f"       {j.title} @ {j.company} | Score-ready tags: {j.tags[:3]}")

    # 4. Apply — uncomment ONLY when ready to test a real apply
    # target = next((j for j in jobs if not j.has_questionnaire), None)
    # if target:
    #     result = jc.apply_job(target)
    #     print(f"[APPLY TEST] {result}")
    # else:
    #     print("[SKIP] All jobs have questionnaires")

    print("\n=== All tests PASSED ===")

asyncio.run(main())
```

Run: `cd backend && python test_naukri.py`

---

## Expected Success Behaviour

- Login returns a Bearer token (starts with `eyJ` or similar) and a non-empty profile ID
- Recommended jobs may return jobs, but it is optional for MVP; a recommendation 401 is non-blocking if `/jobapi/v3/search` works
- Job search returns results for "React developer" in Bangalore with tags populated
- Native apply is allowed only for confirmed native Naukri jobs
- Company-site/external apply jobs return `external_pending` with `external_apply_url` and do not call the native apply API
- Apply returns a success response (check `result.get("status")` or `result.get("message")`)
- After apply, a 30–90 second delay passes before the function returns

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `401 Unauthorized` on login | Wrong credentials or Naukri blocked the IP | Verify credentials; try from a browser on the same machine |
| `401 Unauthorized` on recommended jobs while search works | Recommended endpoint has stricter/stale auth requirements | Treat recommendations as optional; continue with `jobapi/v3/search` and log the recommendation failure as non-blocking |
| `ValueError: no token in response` | Naukri changed the response key name | Log `data.keys()` and update the `.get()` chain |
| `403 Forbidden` on job search | nkparam missing or invalid | Check nkparam was captured; try re-running capture; verify browser is logged in |
| `[]` returned from search | nkparam expired mid-session | Re-capture nkparam before each search batch |
| `has_questionnaire` blocks apply | Job requires custom questions | Filter these out in the apply queue; skip for MVP |
| Session invalidated next day | Old flow saved only a short token, profile was not durable, or IP changed | Reconnect once through guided Connect so Hunter creates the user-scoped profile; keep a static IP for all Naukri requests |

## Challenges

- **nkparam**: This is the hardest part. The Playwright interception approach always works but adds 5–8 seconds per search (browser launch). For MVP this is acceptable. Once the product is working, reverse-engineer the native algorithm from the NopeRi repo to eliminate the browser dependency for search.
- **Token expiry**: Naukri tokens can be short-lived. The persistent Playwright profile should refresh the token silently while the browser session remains valid. If profile refresh fails, surface "Naukri token expired — please reconnect".
- **Easy Apply eligibility**: Not all Naukri jobs support Easy Apply. Check `item.get("easyApply")` or similar flag in the job detail response. Attempting apply on non-Easy-Apply jobs will fail silently or redirect to an external site.
- **External apply safety**: Store raw Naukri apply flags in `portal_metadata`; when native apply cannot be confirmed, return `external_pending` so the user completes the company-site flow manually.
- **Rate detection**: Naukri monitors apply frequency. Never apply more than 20 jobs per day from one account. Always use the `SafeApplyManager` (spec 11) before calling `apply_job()`.
- **Questionnaire jobs**: Some jobs have mandatory screening questions that must be answered before apply. Detect these with the `has_questionnaire` flag and skip them for MVP — they require a separate form-filling flow.
