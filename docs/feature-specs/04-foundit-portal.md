# Feature Spec 04 — Foundit Portal

## What This Is

Integration with Foundit.in (formerly Monster India) using their reverse-engineered internal JSON API. The structure is nearly identical to Naukri — once Naukri works, this takes 1–2 days. Reuses the shared `Job` dataclass from the Naukri module.

## Prerequisites

- `03-naukri-portal.md` complete and test passing (reuses `Job` dataclass)
- A real Foundit account for testing
- Chrome DevTools study of Foundit's network calls
- `portals/foundit/` directory inside `backend/`

## Environment Variables Needed

```
FOUNDIT_EMAIL=your_foundit_email
FOUNDIT_PASSWORD=your_foundit_password
```

---

## Implementation Steps

### Step 1 — DevTools Study

1. Open Chrome → `foundit.in` → login
2. DevTools → Network → Fetch/XHR
3. Capture:

```
LOGIN
  URL: POST https://www.foundit.in/middleware/login
  Body: { "emailId": "...", "password": "..." }
  Response: look for authToken (or token), userId (or id)

JOB SEARCH
  URL: GET https://www.foundit.in/middleware/jobsearch/v2/search
  Headers: Authorization: Bearer <token>
  Params: query, location, experienceRanges, pageNo, pageSize
  Response: look for jobSearchResponse.data array

APPLY
  URL: POST https://www.foundit.in/middleware/applyJob
  Body: { "jobId": "..." }
  Headers: Authorization: Bearer <token>
```

Note the exact field names in responses — they differ from Naukri.

---

### Step 2 — `backend/portals/foundit/auth.py`

```python
import requests
from dataclasses import dataclass
from typing import Optional

FOUNDIT_BASE = "https://www.foundit.in"

BASE_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Origin": "https://www.foundit.in",
    "Referer": "https://www.foundit.in/",
}

@dataclass
class FounditSession:
    bearer_token: str
    user_id: str
    email: str

class FounditAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(BASE_HEADERS)
        self.bearer_token: Optional[str] = None
        self.user_id: Optional[str] = None

    def login(self, email: str, password: str) -> FounditSession:
        url = f"{FOUNDIT_BASE}/middleware/login"
        response = self.session.post(url, json={"emailId": email, "password": password})
        response.raise_for_status()
        data = response.json()

        self.bearer_token = (
            data.get("authToken") or
            data.get("token") or
            data.get("bearerToken")
        )
        self.user_id = (
            data.get("userId") or
            data.get("id") or
            data.get("candidateId")
        )

        if not self.bearer_token:
            raise ValueError(f"Login failed — no token. Response keys: {list(data.keys())}")

        self.session.headers.update({"Authorization": f"Bearer {self.bearer_token}"})
        return FounditSession(self.bearer_token, self.user_id, email)

    def is_token_valid(self) -> bool:
        try:
            response = self.session.get(f"{FOUNDIT_BASE}/middleware/user/profile")
            return response.status_code == 200
        except Exception:
            return False
```

---

### Step 3 — `backend/portals/foundit/jobs.py`

```python
import time
import random
from typing import List
from portals.naukri.jobs import Job  # reuse shared dataclass

FOUNDIT_BASE = "https://www.foundit.in"

class FounditJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def search_jobs(
        self, keyword: str, location: str = "",
        experience: int = 0, page: int = 0
    ) -> List[Job]:
        url = f"{FOUNDIT_BASE}/middleware/jobsearch/v2/search"
        params = {
            "query": keyword,
            "location": location,
            "experienceRanges": f"{experience}-{experience + 2}",
            "pageNo": page,
            "pageSize": 20,
            "sort": "recency",
        }
        response = self.session.get(url, params=params)
        response.raise_for_status()
        return self._parse_jobs(response.json())

    def apply_job(self, job: Job) -> dict:
        url = f"{FOUNDIT_BASE}/middleware/applyJob"
        response = self.session.post(url, json={"jobId": job.job_id})
        time.sleep(random.uniform(30, 90))
        return response.json()

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = (
            data.get("jobSearchResponse", {}).get("data", []) or
            data.get("jobs", []) or
            data.get("data", [])
        )
        for item in items:
            company_data = item.get("company", {})
            company_name = (
                company_data.get("name") if isinstance(company_data, dict)
                else str(company_data)
            )
            skills_raw = item.get("keySkills", "")
            tags = [s.strip() for s in skills_raw.split(",") if s.strip()] if skills_raw else []

            jobs.append(Job(
                job_id=str(item.get("jobId", "")),
                title=item.get("designation", "") or item.get("title", ""),
                company=company_name or "",
                location=item.get("location", "") or item.get("city", ""),
                experience=item.get("experience", ""),
                salary=item.get("salary", "Not disclosed"),
                posted_date=item.get("postedDate", "") or item.get("modifiedOn", ""),
                apply_link=item.get("applyLink", "") or item.get("jdLink", ""),
                description=item.get("jobDescription", ""),
                portal="foundit",
                tags=tags,
            ))
        return jobs
```

---

### Step 4 — Test Script

```python
# backend/test_foundit.py
from portals.foundit.auth import FounditAuthClient
from portals.foundit.jobs import FounditJobClient
from dotenv import load_dotenv
import os

load_dotenv()

def main():
    print("=== Foundit Portal Test ===")

    # 1. Login
    auth = FounditAuthClient()
    session = auth.login(os.getenv("FOUNDIT_EMAIL"), os.getenv("FOUNDIT_PASSWORD"))
    assert session.bearer_token, "No bearer token"
    print(f"[PASS] Login — token: {session.bearer_token[:20]}... user: {session.user_id}")

    # 2. Token validity check
    valid = auth.is_token_valid()
    assert valid, "Token invalid immediately after login"
    print("[PASS] Token validity check")

    jc = FounditJobClient(auth)

    # 3. Job search
    jobs = jc.search_jobs(keyword="Python developer", location="Hyderabad", experience=1)
    assert len(jobs) > 0, f"No jobs returned. Check response structure."
    print(f"[PASS] Search — {len(jobs)} jobs returned")
    for j in jobs[:3]:
        print(f"       [{j.job_id}] {j.title} @ {j.company} | {j.location}")
        assert j.job_id, "Missing job_id"
        assert j.title, "Missing title"

    # 4. Apply test — uncomment only when ready
    # result = jc.apply_job(jobs[0])
    # print(f"[APPLY TEST] {result}")

    print("\n=== All tests PASSED ===")

main()
```

Run: `cd backend && python test_foundit.py`

---

## Expected Success Behaviour

- Login returns a Bearer token and user ID without error
- `is_token_valid()` returns `True` immediately after login
- Job search for "Python developer" in Hyderabad returns at least 5 jobs
- Each job has a non-empty `job_id`, `title`, and `company`
- `apply_job()` returns a JSON response with no HTTP error (check for a success/status field)

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `401` on login | Wrong credentials | Verify by logging in manually on foundit.in |
| `ValueError: no token` | Foundit changed response key | Print `data.keys()` on login response and update `.get()` chain |
| `[]` from search | API params wrong or response structure changed | Print `data.keys()` from search response; check for nested key path |
| `KeyError` in `_parse_jobs` | Field missing in some job items | All field access must use `.get()` with defaults — no direct key access |
| `429 Too Many Requests` | Applying too fast | Increase delays in `SafeApplyManager`; reduce daily limit |
| `403` on apply | Token expired or job not eligible for easy apply | Re-login; check if job supports direct apply |

## Challenges

- **Response structure instability**: Foundit's API response keys have changed multiple times. Always use `.get()` with fallbacks. Log the full response when debugging so you can see what actually came back.
- **Experience range format**: The `experienceRanges` parameter is a string like `"2-4"`. If you pass an integer or omit it, you may get results but with wrong experience filtering. Verify the exact format from DevTools.
- **Company name field**: Sometimes `company` is a nested object `{ "name": "..." }`, sometimes it's a plain string. The parser handles both cases above — verify which format your DevTools capture shows.
- **No nkparam**: Unlike Naukri, Foundit does not require an nkparam equivalent — the Bearer token alone is sufficient. This makes search much simpler.
- **Session sharing with Naukri**: Foundit tokens can coexist with Naukri tokens in the same run. They are independent `requests.Session` objects. Do not confuse them.
