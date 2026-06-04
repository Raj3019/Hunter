# Feature Spec 03 — Naukri Portal

## What This Is

Integration with Naukri.com using their reverse-engineered internal JSON API — the same endpoints their own browser calls. Covers login (Bearer token capture), job search (including the nkparam signature header), recommended jobs, and Easy Apply. This is the highest-priority portal and the first one to build.

## Prerequisites

- `02-core-backend-setup.md` complete
- A real Naukri account (your own) for testing
- Chrome DevTools to intercept the API calls once before coding
- `portals/naukri/` directory created inside `backend/`

## Environment Variables Needed

```
NAUKRI_USERNAME=your_naukri_email
NAUKRI_PASSWORD=your_naukri_password
```

---

## Implementation Steps

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
- Recommended jobs returns at least 5 jobs with title, company, and location populated
- Job search returns results for "React developer" in Bangalore with tags populated
- Apply returns a success response (check `result.get("status")` or `result.get("message")`)
- After apply, a 30–90 second delay passes before the function returns

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `401 Unauthorized` on login | Wrong credentials or Naukri blocked the IP | Verify credentials; try from a browser on the same machine |
| `ValueError: no token in response` | Naukri changed the response key name | Log `data.keys()` and update the `.get()` chain |
| `403 Forbidden` on job search | nkparam missing or invalid | Check nkparam was captured; try re-running capture; verify browser is logged in |
| `[]` returned from search | nkparam expired mid-session | Re-capture nkparam before each search batch |
| `has_questionnaire` blocks apply | Job requires custom questions | Filter these out in the apply queue; skip for MVP |
| Session invalidated next day | IP changed (Elastic IP not set up yet) | Use a static IP for all Naukri requests — even in dev, restart won't change home IP |

## Challenges

- **nkparam**: This is the hardest part. The Playwright interception approach always works but adds 5–8 seconds per search (browser launch). For MVP this is acceptable. Once the product is working, reverse-engineer the native algorithm from the NopeRi repo to eliminate the browser dependency for search.
- **Token expiry**: Naukri tokens typically last 24–48 hours. The scheduler must detect a 401 response, surface it to the user ("Naukri token expired — please reconnect"), and stop trying to apply until a fresh token is saved.
- **Easy Apply eligibility**: Not all Naukri jobs support Easy Apply. Check `item.get("easyApply")` or similar flag in the job detail response. Attempting apply on non-Easy-Apply jobs will fail silently or redirect to an external site.
- **Rate detection**: Naukri monitors apply frequency. Never apply more than 20 jobs per day from one account. Always use the `SafeApplyManager` (spec 11) before calling `apply_job()`.
- **Questionnaire jobs**: Some jobs have mandatory screening questions that must be answered before apply. Detect these with the `has_questionnaire` flag and skip them for MVP — they require a separate form-filling flow.
