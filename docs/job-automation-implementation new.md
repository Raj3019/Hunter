# Job Automation App — Technical Implementation Plan

Coding-first, step-by-step implementation guide.
No business strategy. Pure technical execution.

---

## What We Are Building

A web app that:
1. Takes user's resume + job preferences
2. Logs into portals using the user's own session token (manual login once)
3. Searches jobs across multiple portals, scores them against resume using AI
4. Tailors resume per job description (user approves before apply)
5. Applies automatically with safe rate limiting
6. Tracks every application in a dashboard

---

## Scraping vs API Calls — Important Distinction

```
SCRAPING = Reading raw HTML and parsing it with BeautifulSoup etc
           Fragile — breaks when CSS class names change

REVERSE ENGINEERED API = Calling the same internal JSON endpoints
                         the website's own browser uses
                         Stable — returns clean JSON

PLAYWRIGHT AUTOMATION = Controlling a real browser to click through forms
                        Used when no internal API exists
```

| Portal | Approach | Why |
|---|---|---|
| Naukri | Reverse engineered internal API | Has clean JSON API, no scraping needed |
| Foundit | Reverse engineered internal API | Similar structure to Naukri |
| Internshala | Internal API + Playwright | API for search, Playwright for apply form |
| LinkedIn | Playwright browser automation | Easy Apply is a browser modal, no API |
| Indeed India | Playwright | Blocks direct API calls heavily |
| Workday sites | Playwright | Standardised form across 100+ companies |
| Taleo sites | Playwright | Standardised form across many companies |
| TCS/Infosys/Accenture | Playwright | Custom portals, unique per company |

**We are NOT scraping Naukri or Foundit.**
We are calling their own internal APIs directly — the same calls their browser makes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Frontend | React 18 + Tailwind CSS |
| Database | PostgreSQL via Supabase free tier |
| AI | Claude API (claude-sonnet-4-20250514) |
| Browser automation | Playwright (Python) |
| Job scheduler | APScheduler |
| Notifications | Twilio WhatsApp API |
| Auth | Supabase Auth (JWT) |
| Hosting | AWS EC2 t2.micro + Elastic IP |
| Env management | python-dotenv |

---

## Project Folder Structure

```
job-automation/
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   ├── .env                         # never commit
│   ├── core/
│   │   ├── config.py                # env vars, constants
│   │   └── database.py              # Supabase connection
│   ├── portals/
│   │   ├── base.py                  # shared base class for all portals
│   │   ├── naukri/
│   │   │   ├── auth.py              # login, token, session
│   │   │   ├── jobs.py              # search, recommended jobs
│   │   │   ├── apply.py             # easy apply
│   │   │   └── nkparam.py           # nkparam token generator
│   │   ├── foundit/
│   │   │   ├── auth.py
│   │   │   ├── jobs.py
│   │   │   └── apply.py
│   │   ├── internshala/
│   │   │   ├── auth.py
│   │   │   ├── jobs.py
│   │   │   └── apply.py             # Playwright-based
│   │   ├── linkedin/
│   │   │   ├── auth.py              # persistent Chrome profile
│   │   │   ├── jobs.py              # job search
│   │   │   └── apply.py             # Playwright Easy Apply
│   │   ├── workday/
│   │   │   ├── apply.py             # generic Workday form handler
│   │   │   └── companies.py         # list of Workday company URLs
│   │   ├── taleo/
│   │   │   └── apply.py             # generic Taleo form handler
│   │   └── custom/
│   │       ├── tcs.py
│   │       ├── infosys.py
│   │       └── accenture.py
│   ├── ai/
│   │   ├── resume_parser.py
│   │   ├── job_scorer.py
│   │   ├── resume_tailor.py
│   │   └── qa_answerer.py           # answers job questionnaires
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.py
│   │   │   ├── resume.py
│   │   │   ├── preferences.py
│   │   │   ├── jobs.py
│   │   │   ├── applications.py
│   │   │   └── portals.py
│   │   └── models/
│   │       ├── user.py
│   │       ├── job.py
│   │       └── application.py
│   └── scheduler/
│       └── daily_fetch.py
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Onboarding.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Tracker.jsx
│   │   │   └── Settings.jsx
│   │   ├── components/
│   │   │   ├── JobCard.jsx
│   │   │   ├── ResumePreview.jsx
│   │   │   └── PortalConnect.jsx
│   │   └── api/
│   │       └── client.js
│   └── package.json
│
└── docker-compose.yml
```

---

## Database Schema (Supabase — paste into SQL editor)

```sql
-- Extend Supabase auth users
create table public.profiles (
  id uuid references auth.users primary key,
  email text,
  created_at timestamp default now()
);

-- Parsed resume data
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  file_url text,
  parsed_data jsonb,
  created_at timestamp default now()
);

-- Job preferences
create table public.preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  job_titles text[],
  locations text[],
  work_type text[],
  min_salary integer,
  max_salary integer,
  experience_years integer,
  avoid_companies text[],
  updated_at timestamp default now()
);

-- Portal tokens (never store passwords)
create table public.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  portal text,           -- 'naukri', 'linkedin', 'foundit', 'internshala'
  bearer_token text,     -- encrypted at rest
  profile_id text,
  chrome_profile_path text,  -- for Playwright-based portals
  expires_at timestamp,
  created_at timestamp default now()
);

-- All jobs fetched across all portals
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  portal text,
  job_id text,
  title text,
  company text,
  location text,
  description text,
  salary text,
  experience text,
  tags text[],
  apply_link text,
  posted_date text,
  is_workday boolean default false,
  is_taleo boolean default false,
  fetched_at timestamp default now(),
  unique(portal, job_id)
);

-- Scored job matches per user
create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  job_id uuid references public.jobs(id),
  match_score integer,
  match_reasons text[],
  status text default 'pending',   -- 'pending', 'approved', 'skipped'
  created_at timestamp default now()
);

-- Application tracker
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  job_id uuid references public.jobs(id),
  portal text,
  applied_at timestamp default now(),
  status text default 'applied',   -- 'applied', 'viewed', 'rejected', 'interview'
  tailored_resume_url text,
  notes text,
  updated_at timestamp default now()
);
```

---

## Phase 1 — Naukri (Week 1-2)
### Approach: Reverse Engineered Internal API

### Step 1.1 — Intercept Naukri APIs with DevTools

1. Open Chrome → naukri.com → login with your account
2. DevTools → Network tab → filter Fetch/XHR
3. Capture these exact requests:

```
LOGIN
POST https://www.naukri.com/central-login-services/v1/login
Body: { username, password }
Response: { authToken, profileId, ... }

RECOMMENDED JOBS
GET https://www.naukri.com/recommended-jobs-service/v1/reco
Headers: Authorization: Bearer <token>

JOB SEARCH
GET https://www.naukri.com/jobapi/v3/search
Headers: nkparam: <token>, Authorization: Bearer <token>
Params: keyword, location, experience, pageNo

EASY APPLY
POST https://www.naukri.com/apply-service/v1/apply
Headers: Authorization: Bearer <token>
Body: { jobId, ... }

RESUME UPLOAD
POST https://www.naukri.com/profile-update-services/v1/resume
```

> Reference: github.com/Traverser25/NopeRi — study their endpoint map.
> Do NOT copy code. Use it only as a reference for what URLs to look for.

### Step 1.2 — The nkparam Problem

```
nkparam is an encrypted signature header required for job search.
Without it: 403 Forbidden.
Generated from: timestamp + session data + obfuscated JS logic.

Solution A (best): Study NopeRi's nkparam_generator.py, understand
  the algorithm, rewrite your own version from scratch.

Solution B (fallback): Use Playwright to intercept it from a real
  browser request. Slower but always works.
```

Playwright fallback to capture nkparam:

```python
# backend/portals/naukri/nkparam.py

from playwright.async_api import async_playwright
import asyncio

async def capture_nkparam_via_browser(keyword: str = "developer") -> str:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="./chrome_profiles/naukri",
            headless=False
        )
        page = await browser.new_page()
        captured = {}

        async def on_request(request):
            if "jobapi/v3/search" in request.url:
                nk = request.headers.get("nkparam")
                if nk:
                    captured["nkparam"] = nk

        page.on("request", on_request)
        await page.goto(f"https://www.naukri.com/{keyword}-jobs")
        await asyncio.sleep(4)
        await browser.close()
        return captured.get("nkparam", "")
```

### Step 1.3 — Naukri Auth Client

```python
# backend/portals/naukri/auth.py

import requests
from dataclasses import dataclass
from typing import Optional

NAUKRI_BASE = "https://www.naukri.com"

BASE_HEADERS = {
    "Content-Type": "application/json",
    "appid": "109",
    "systemid": "Naukri",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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

        self.bearer_token = data.get("authToken") or data.get("token")
        self.profile_id = data.get("profileId") or data.get("userId")
        self.session.headers.update({"Authorization": f"Bearer {self.bearer_token}"})

        return NaukriSession(self.bearer_token, self.profile_id, username)

    def upload_resume(self, pdf_path: str) -> dict:
        url = f"{NAUKRI_BASE}/profile-update-services/v1/user/{self.profile_id}/resume"
        with open(pdf_path, "rb") as f:
            response = self.session.post(url, files={"resume": (pdf_path, f, "application/pdf")})
        return response.json()

    def update_headline(self, headline: str) -> dict:
        url = f"{NAUKRI_BASE}/profile-update-services/v1/user/{self.profile_id}"
        response = self.session.put(url, json={"resumeHeadline": headline})
        return response.json()
```

### Step 1.4 — Naukri Job Client

```python
# backend/portals/naukri/jobs.py

import time, random
from dataclasses import dataclass, field
from typing import List
from .auth import NaukriAuthClient
from .nkparam import capture_nkparam_via_browser

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

class NaukriJobClient:
    def __init__(self, auth: NaukriAuthClient):
        self.auth = auth
        self.session = auth.session

    def get_recommended_jobs(self) -> List[Job]:
        url = "https://www.naukri.com/recommended-jobs-service/v1/reco"
        response = self.session.get(url)
        return self._parse_jobs(response.json())

    async def search_jobs(self, keyword: str, location: str = "",
                          experience: int = 0, page: int = 1) -> List[Job]:
        nkparam = await capture_nkparam_via_browser(keyword)
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
        return self._parse_jobs(response.json())

    def apply_job(self, job: Job) -> dict:
        if job.has_questionnaire:
            raise Exception(f"Skipping — questionnaire required for: {job.title}")

        url = "https://www.naukri.com/apply-service/v1/apply"
        payload = {"jobId": job.job_id}
        response = self.session.post(url, json=payload)

        # Human-like delay after every apply
        time.sleep(random.uniform(30, 90))
        return response.json()

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = data.get("jobDetails") or data.get("jobs") or []
        for item in items:
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
                tags=item.get("tagsAndSkills", "").split(","),
            ))
        return jobs
```

### Step 1.5 — Test Naukri Client

```python
# test_naukri.py — run this. must pass before moving to Phase 2.

import asyncio
from backend.portals.naukri.auth import NaukriAuthClient
from backend.portals.naukri.jobs import NaukriJobClient
from dotenv import load_dotenv
import os

load_dotenv()

async def test():
    auth = NaukriAuthClient()
    session = auth.login(os.getenv("NAUKRI_USERNAME"), os.getenv("NAUKRI_PASSWORD"))
    print(f"Login OK. Token starts with: {session.bearer_token[:20]}")

    jc = NaukriJobClient(auth)

    jobs = jc.get_recommended_jobs()
    print(f"Recommended: {len(jobs)} jobs found")

    jobs = await jc.search_jobs(keyword="React developer", location="Bangalore")
    print(f"Search: {len(jobs)} jobs found")
    for j in jobs[:3]:
        print(f"  {j.title} — {j.company} — {j.location}")

    # Uncomment only when ready to test real apply:
    # result = jc.apply_job(jobs[0])
    # print(f"Apply result: {result}")

asyncio.run(test())
```

**Do not move to Phase 2 until this test fully passes.**

---

## Phase 2 — Foundit (Week 3)
### Approach: Reverse Engineered Internal API

Foundit (formerly Monster India) has a very similar API structure to Naukri.
Once Naukri works, this takes 1-2 days.

### Step 2.1 — Intercept Foundit APIs

Same process as Naukri — DevTools → Network tab → capture:

```
LOGIN
POST https://www.foundit.in/middleware/login
Body: { emailId, password }
Response: { authToken, userId, ... }

JOB SEARCH
GET https://www.foundit.in/middleware/jobsearch/v2/search
Params: query, location, experienceRanges, pageNo
Headers: Authorization: Bearer <token>

APPLY
POST https://www.foundit.in/middleware/applyJob
Headers: Authorization: Bearer <token>
Body: { jobId, ... }
```

### Step 2.2 — Foundit Auth Client

```python
# backend/portals/foundit/auth.py

import requests
from dataclasses import dataclass

FOUNDIT_BASE = "https://www.foundit.in"

BASE_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

@dataclass
class FounditSession:
    bearer_token: str
    user_id: str

class FounditAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(BASE_HEADERS)
        self.bearer_token = None
        self.user_id = None

    def login(self, email: str, password: str) -> FounditSession:
        url = f"{FOUNDIT_BASE}/middleware/login"
        response = self.session.post(url, json={"emailId": email, "password": password})
        response.raise_for_status()
        data = response.json()

        # Exact keys from DevTools
        self.bearer_token = data.get("authToken") or data.get("token")
        self.user_id = data.get("userId") or data.get("id")
        self.session.headers.update({"Authorization": f"Bearer {self.bearer_token}"})

        return FounditSession(self.bearer_token, self.user_id)
```

### Step 2.3 — Foundit Job Search + Apply

```python
# backend/portals/foundit/jobs.py

import time, random
from typing import List
from .auth import FounditAuthClient
from backend.portals.naukri.jobs import Job  # reuse same Job dataclass

class FounditJobClient:
    def __init__(self, auth: FounditAuthClient):
        self.session = auth.session

    def search_jobs(self, keyword: str, location: str = "",
                    experience: int = 0, page: int = 0) -> List[Job]:
        url = "https://www.foundit.in/middleware/jobsearch/v2/search"
        params = {
            "query": keyword,
            "location": location,
            "experienceRanges": f"{experience}-{experience+2}",
            "pageNo": page,
            "pageSize": 20,
        }
        response = self.session.get(url, params=params)
        return self._parse_jobs(response.json())

    def apply_job(self, job: Job) -> dict:
        url = "https://www.foundit.in/middleware/applyJob"
        response = self.session.post(url, json={"jobId": job.job_id})
        time.sleep(random.uniform(30, 90))
        return response.json()

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = data.get("jobSearchResponse", {}).get("data", [])
        for item in items:
            jobs.append(Job(
                job_id=str(item.get("jobId", "")),
                title=item.get("designation", ""),
                company=item.get("company", {}).get("name", ""),
                location=item.get("location", ""),
                experience=item.get("experience", ""),
                salary=item.get("salary", "Not disclosed"),
                posted_date=item.get("postedDate", ""),
                apply_link=item.get("applyLink", ""),
                description=item.get("jobDescription", ""),
                portal="foundit",
                tags=item.get("keySkills", "").split(","),
            ))
        return jobs
```

---

## Phase 3 — Internshala (Week 3)
### Approach: Internal API for search, Playwright for apply

Internshala is the main portal for internships and fresher jobs in India.
Weaker bot protection than Naukri or LinkedIn.

### Step 3.1 — Internshala Auth (API-based)

```python
# backend/portals/internshala/auth.py

import requests
from dataclasses import dataclass

INTERNSHALA_BASE = "https://internshala.com"

@dataclass
class InternshalaSession:
    csrf_token: str
    session_cookie: str

class InternshalaAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
        })

    def login(self, email: str, password: str) -> InternshalaSession:
        # Step 1: Get login page to capture CSRF token
        login_page = self.session.get(f"{INTERNSHALA_BASE}/login")
        # Extract CSRF token from page HTML or cookies
        # (capture exact token name from DevTools)

        # Step 2: POST login
        response = self.session.post(
            f"{INTERNSHALA_BASE}/login/submit_login",
            data={"email": email, "password": password}
            # add CSRF token if required
        )
        response.raise_for_status()
        return InternshalaSession(
            csrf_token=response.cookies.get("csrf_token", ""),
            session_cookie=response.cookies.get("PHPSESSID", "")
        )
```

### Step 3.2 — Internshala Job Search (API)

```python
# backend/portals/internshala/jobs.py

import requests
from typing import List
from backend.portals.naukri.jobs import Job

class InternshalaJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def search_internships(self, keyword: str = "", location: str = "") -> List[Job]:
        # Internshala has a clean internal API — capture from DevTools
        url = "https://internshala.com/internships/ajax"
        params = {
            "search_po": keyword,
            "location_po": location,
        }
        response = self.session.get(url, params=params)
        return self._parse(response.json())

    def search_jobs(self, keyword: str = "", location: str = "") -> List[Job]:
        url = "https://internshala.com/jobs/ajax"
        params = {
            "search_po": keyword,
            "location_po": location,
        }
        response = self.session.get(url, params=params)
        return self._parse(response.json())

    def _parse(self, data: dict) -> List[Job]:
        jobs = []
        items = data.get("internships_meta") or data.get("jobs_meta") or {}
        for key, item in items.items():
            jobs.append(Job(
                job_id=str(item.get("id", "")),
                title=item.get("profile_name", ""),
                company=item.get("company_name", ""),
                location=item.get("location_names", [""])[0],
                experience="Fresher",
                salary=item.get("stipend", {}).get("salary", "Unpaid"),
                posted_date=item.get("start_date", ""),
                apply_link=f"https://internshala.com{item.get('application_url', '')}",
                description=item.get("other_details", ""),
                portal="internshala",
                tags=item.get("skills", []),
            ))
        return jobs
```

### Step 3.3 — Internshala Apply (Playwright)

Apply on Internshala requires filling a form — use Playwright:

```python
# backend/portals/internshala/apply.py

from playwright.async_api import async_playwright
import asyncio, random, time

async def internshala_apply(job_url: str, cover_letter: str,
                             profile_dir: str = "./chrome_profiles/internshala"):
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False
        )
        page = await browser.new_page()
        await page.goto(job_url)
        await page.wait_for_timeout(2000)

        # Click Apply button
        apply_btn = await page.query_selector("button#apply_button, a.apply_now")
        if not apply_btn:
            print(f"No apply button found at {job_url}")
            await browser.close()
            return {"success": False, "reason": "No apply button"}

        await apply_btn.click()
        await page.wait_for_timeout(1500)

        # Fill cover letter if field exists
        cover_field = await page.query_selector("textarea#cover_letter")
        if cover_field:
            await cover_field.fill(cover_letter)

        # Submit
        submit_btn = await page.query_selector("button#submit")
        if submit_btn:
            await submit_btn.click()
            await page.wait_for_timeout(2000)

        await browser.close()

        # Human-like delay
        await asyncio.sleep(random.uniform(20, 60))
        return {"success": True}
```

---

## Phase 4 — LinkedIn (Week 4-5)
### Approach: Playwright browser automation only

LinkedIn actively fights automation. The safest approach is a persistent
Chrome profile where the user has already logged in manually.

### Step 4.1 — LinkedIn Setup

```
The user must:
1. Open Chrome with the Playwright profile path
2. Go to linkedin.com and login manually
3. That session is saved in the profile
4. All future automation uses that saved session
5. No password ever stored in your app
```

### Step 4.2 — LinkedIn Job Search

```python
# backend/portals/linkedin/jobs.py

from playwright.async_api import async_playwright
from typing import List
from backend.portals.naukri.jobs import Job
import asyncio

PROFILE_DIR = "./chrome_profiles/linkedin"

async def search_linkedin_jobs(keyword: str, location: str = "India",
                                experience_level: str = "2") -> List[Job]:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False
        )
        page = await browser.new_page()

        search_url = (
            f"https://www.linkedin.com/jobs/search/"
            f"?keywords={keyword}&location={location}"
            f"&f_E={experience_level}"   # experience level filter
            f"&f_LF=f_AL"               # Easy Apply only filter
        )

        jobs = []
        captured_jobs = []

        # Intercept the internal API response
        async def on_response(response):
            if "voyager/api/jobs/jobPostings" in response.url:
                try:
                    data = await response.json()
                    captured_jobs.append(data)
                except:
                    pass

        page.on("response", on_response)
        await page.goto(search_url)
        await asyncio.sleep(4)

        # Parse captured API responses
        for data in captured_jobs:
            elements = data.get("elements", [])
            for el in elements:
                job_data = el.get("jobCardUnion", {}).get("jobPostingCard", {})
                if job_data:
                    jobs.append(Job(
                        job_id=str(job_data.get("entityUrn", "").split(":")[-1]),
                        title=job_data.get("jobPostingTitle", ""),
                        company=job_data.get("primaryDescription", {}).get("text", ""),
                        location=job_data.get("secondaryDescription", {}).get("text", ""),
                        experience="",
                        salary="",
                        posted_date=str(job_data.get("listedAt", "")),
                        apply_link=f"https://www.linkedin.com/jobs/view/{job_data.get('entityUrn', '').split(':')[-1]}",
                        description="",
                        portal="linkedin",
                        has_questionnaire=False
                    ))

        await browser.close()
        return jobs
```

### Step 4.3 — LinkedIn Easy Apply

```python
# backend/portals/linkedin/apply.py

from playwright.async_api import async_playwright
from backend.ai.qa_answerer import answer_question
import asyncio, random

PROFILE_DIR = "./chrome_profiles/linkedin"
DAILY_LIMIT = 30   # LinkedIn safe daily limit

async def linkedin_easy_apply(job_url: str, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False
        )
        page = await browser.new_page()
        await page.goto(job_url)
        await page.wait_for_timeout(2000)

        # Click Easy Apply
        try:
            await page.click("button:has-text('Easy Apply')", timeout=5000)
        except:
            await browser.close()
            return {"success": False, "reason": "No Easy Apply button"}

        # Walk through multi-step form
        max_steps = 10
        for step in range(max_steps):
            await page.wait_for_timeout(1500)

            # Handle any questions that appear
            questions = await page.query_selector_all("input[type='text'], textarea, select")
            for q in questions:
                label = await q.get_attribute("aria-label") or ""
                if label and not await q.input_value():
                    # Use AI to answer if needed
                    answer = await answer_question(label, user_profile)
                    await q.fill(answer)

            # Try to proceed
            submit = await page.query_selector("button:has-text('Submit application')")
            if submit:
                await submit.click()
                await page.wait_for_timeout(2000)
                await browser.close()
                await asyncio.sleep(random.uniform(30, 90))
                return {"success": True}

            next_btn = await page.query_selector("button:has-text('Next')")
            review_btn = await page.query_selector("button:has-text('Review')")

            if next_btn:
                await next_btn.click()
            elif review_btn:
                await review_btn.click()
            else:
                break

        await browser.close()
        return {"success": False, "reason": "Could not complete form"}
```

---

## Phase 5 — Workday (Week 6-7)
### Approach: Playwright — ONE implementation covers 100+ companies

This is the highest value automation target. Workday powers:
Wipro, IBM India, Capgemini, Deloitte, PwC, EY, KPMG, Adobe India,
Cisco India, Dell India, HP India, Accenture (partial), and hundreds more.

Build it once = applies to all of them.

### Step 5.1 — Workday Company List

```python
# backend/portals/workday/companies.py

WORKDAY_COMPANIES = {
    "wipro": {
        "name": "Wipro",
        "careers_url": "https://careers.wipro.com/careers-home/jobs",
        "apply_base": "https://wipro.wd3.myworkdayjobs.com",
    },
    "ibm": {
        "name": "IBM India",
        "careers_url": "https://www.ibm.com/in-en/employment",
        "apply_base": "https://ibm.wd12.myworkdayjobs.com",
    },
    "capgemini": {
        "name": "Capgemini",
        "careers_url": "https://www.capgemini.com/in-en/careers/job-search",
        "apply_base": "https://capgemini.wd3.myworkdayjobs.com",
    },
    "deloitte": {
        "name": "Deloitte India",
        "careers_url": "https://apply.deloitte.com/careers/SearchJobs",
        "apply_base": "https://deloitte.wd1.myworkdayjobs.com",
    },
    "adobe": {
        "name": "Adobe India",
        "careers_url": "https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced",
        "apply_base": "https://adobe.wd5.myworkdayjobs.com",
    },
    # Add more as needed
}
```

### Step 5.2 — Generic Workday Job Search

```python
# backend/portals/workday/jobs.py

from playwright.async_api import async_playwright
from typing import List
from backend.portals.naukri.jobs import Job
import asyncio

async def search_workday_jobs(company_key: str, keyword: str,
                               location: str = "India") -> List[Job]:
    from .companies import WORKDAY_COMPANIES
    company = WORKDAY_COMPANIES.get(company_key)
    if not company:
        return []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        jobs = []
        captured = []

        async def on_response(response):
            if "jobs" in response.url and "myworkdayjobs.com" in response.url:
                try:
                    data = await response.json()
                    captured.append(data)
                except:
                    pass

        page.on("response", on_response)
        await page.goto(company["careers_url"])

        # Search for keyword
        search_box = await page.query_selector("input[placeholder*='Search'], input[type='search']")
        if search_box:
            await search_box.fill(keyword)
            await search_box.press("Enter")
            await asyncio.sleep(3)

        # Parse intercepted API responses
        for data in captured:
            job_postings = data.get("jobPostings", [])
            for posting in job_postings:
                jobs.append(Job(
                    job_id=posting.get("bulletFields", [""])[0],
                    title=posting.get("title", ""),
                    company=company["name"],
                    location=posting.get("locationsText", location),
                    experience="",
                    salary="",
                    posted_date=posting.get("postedOn", ""),
                    apply_link=f"{company['apply_base']}{posting.get('externalPath', '')}",
                    description=posting.get("jobDescription", ""),
                    portal="workday",
                ))

        await browser.close()
        return jobs
```

### Step 5.3 — Generic Workday Apply

```python
# backend/portals/workday/apply.py

from playwright.async_api import async_playwright
from backend.ai.qa_answerer import answer_question
import asyncio, random

PROFILE_DIR = "./chrome_profiles/workday"

async def workday_apply(job_url: str, resume_path: str,
                        user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False
        )
        page = await browser.new_page()
        await page.goto(job_url)
        await page.wait_for_timeout(2000)

        # Click Apply button
        try:
            await page.click("a:has-text('Apply'), button:has-text('Apply')", timeout=5000)
        except:
            await browser.close()
            return {"success": False, "reason": "No Apply button found"}

        await page.wait_for_timeout(2000)

        # Handle multi-step Workday form
        for step in range(15):
            await page.wait_for_timeout(1500)

            # Upload resume if file input appears
            file_input = await page.query_selector("input[type='file']")
            if file_input:
                await file_input.set_input_files(resume_path)
                await page.wait_for_timeout(1000)

            # Fill text fields using AI
            text_inputs = await page.query_selector_all(
                "input[type='text']:not([readonly]), textarea:not([readonly])"
            )
            for inp in text_inputs:
                label = await inp.get_attribute("aria-label") or ""
                placeholder = await inp.get_attribute("placeholder") or ""
                field_name = label or placeholder
                if field_name and not await inp.input_value():
                    answer = await answer_question(field_name, user_profile)
                    if answer:
                        await inp.fill(answer)

            # Fill dropdowns
            selects = await page.query_selector_all("select")
            for sel in selects:
                options = await sel.query_selector_all("option")
                if len(options) > 1:
                    await sel.select_option(index=1)

            # Try to go next or submit
            submit = await page.query_selector("button:has-text('Submit'), button:has-text('Apply')")
            next_btn = await page.query_selector("button:has-text('Next'), button:has-text('Continue')")

            if submit:
                await submit.click()
                await page.wait_for_timeout(2000)
                await browser.close()
                await asyncio.sleep(random.uniform(30, 90))
                return {"success": True}
            elif next_btn:
                await next_btn.click()
            else:
                break

        await browser.close()
        return {"success": False, "reason": "Form could not be completed"}
```

---

## Phase 6 — Taleo (Week 7)
### Approach: Playwright — covers HCL, Oracle India, many others

```python
# backend/portals/taleo/companies.py

TALEO_COMPANIES = {
    "hcl": {
        "name": "HCL Technologies",
        "careers_url": "https://www.hcltech.com/careers",
        "taleo_base": "https://hcl.taleo.net",
    },
    "oracle": {
        "name": "Oracle India",
        "careers_url": "https://oracle.taleo.net/careersection/2/jobsearch.ftl",
        "taleo_base": "https://oracle.taleo.net",
    },
    # Add more
}
```

```python
# backend/portals/taleo/apply.py

from playwright.async_api import async_playwright
from backend.ai.qa_answerer import answer_question
import asyncio, random

async def taleo_apply(job_url: str, resume_path: str, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="./chrome_profiles/taleo",
            headless=False
        )
        page = await browser.new_page()
        await page.goto(job_url)
        await page.wait_for_timeout(2000)

        # Taleo forms are iframe-based — switch context
        frames = page.frames
        app_frame = None
        for frame in frames:
            if "taleo" in frame.url:
                app_frame = frame
                break

        target = app_frame or page

        # Click Apply
        try:
            await target.click("a:has-text('Apply Online'), button:has-text('Apply')", timeout=5000)
        except:
            await browser.close()
            return {"success": False, "reason": "No Apply button"}

        await page.wait_for_timeout(2000)

        # Fill form steps (same pattern as Workday)
        for step in range(10):
            await page.wait_for_timeout(1500)

            file_input = await page.query_selector("input[type='file']")
            if file_input:
                await file_input.set_input_files(resume_path)

            inputs = await page.query_selector_all("input[type='text'], textarea")
            for inp in inputs:
                label = await inp.get_attribute("aria-label") or ""
                if label and not await inp.input_value():
                    answer = await answer_question(label, user_profile)
                    if answer:
                        await inp.fill(answer)

            submit = await page.query_selector("input[type='submit'], button:has-text('Submit')")
            next_btn = await page.query_selector("button:has-text('Next')")

            if submit:
                await submit.click()
                await asyncio.sleep(random.uniform(30, 90))
                await browser.close()
                return {"success": True}
            elif next_btn:
                await next_btn.click()
            else:
                break

        await browser.close()
        return {"success": False, "reason": "Form incomplete"}
```

---

## Phase 7 — Custom Company Portals (Week 8)

### TCS iBegin

```python
# backend/portals/custom/tcs.py

from playwright.async_api import async_playwright
import asyncio

TCS_CAREERS_URL = "https://ibegin.tcs.com/iBegin/"

async def search_tcs_jobs(keyword: str, experience: int = 0) -> list:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="./chrome_profiles/tcs",
            headless=False
        )
        page = await browser.new_page()
        await page.goto(TCS_CAREERS_URL)
        await page.wait_for_timeout(2000)

        # TCS has a specific search form — capture from DevTools
        # Search by keyword
        search_input = await page.query_selector("input[name='searchKey'], input#keyword")
        if search_input:
            await search_input.fill(keyword)
            await search_input.press("Enter")
            await asyncio.sleep(3)

        # Capture job results from the page
        job_cards = await page.query_selector_all(".job-item, .job-card, tr.jobRow")
        jobs = []
        for card in job_cards:
            title = await card.query_selector(".job-title, td.title")
            link = await card.query_selector("a")
            if title and link:
                jobs.append({
                    "title": await title.inner_text(),
                    "url": await link.get_attribute("href"),
                    "company": "TCS",
                    "portal": "tcs"
                })

        await browser.close()
        return jobs
```

### Infosys Careers

```python
# backend/portals/custom/infosys.py

from playwright.async_api import async_playwright
import asyncio

INFOSYS_CAREERS_URL = "https://career.infosys.com/jobdesc"

async def search_infosys_jobs(keyword: str, location: str = "") -> list:
    # Infosys uses internal API — intercept from DevTools
    # URL pattern: https://career.infosys.com/api/jobs/search
    import requests

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    }
    params = {
        "searchText": keyword,
        "location": location,
        "pageNo": 1,
        "pageSize": 20,
    }
    # Exact URL and params from DevTools
    response = requests.get(
        "https://career.infosys.com/api/jobs/search",
        params=params,
        headers=headers
    )
    return response.json().get("jobs", [])
```

---

## Phase 8 — AI Layer (Week 3, runs parallel)

### Resume Parser

```python
# backend/ai/resume_parser.py

import anthropic, json, PyPDF2

client = anthropic.Anthropic()

def extract_pdf_text(path: str) -> str:
    text = ""
    with open(path, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        for page in reader.pages:
            text += page.extract_text() or ""
    return text

async def parse_resume(pdf_path: str) -> dict:
    text = extract_pdf_text(pdf_path)
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1000,
        messages=[{"role": "user", "content": f"""Extract from this resume.
Return ONLY valid JSON, no other text:
{{
  "name": "",
  "email": "",
  "phone": "",
  "current_role": "",
  "total_experience_years": 0,
  "skills": [],
  "education": "",
  "summary": "",
  "previous_companies": []
}}
Resume:
{text}"""}]
    )
    return json.loads(msg.content[0].text.strip())
```

### Job Scorer

```python
# backend/ai/job_scorer.py

import anthropic, json

client = anthropic.Anthropic()

async def score_job(resume: dict, job: dict) -> dict:
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=400,
        messages=[{"role": "user", "content": f"""Score this candidate for this job.
Return ONLY valid JSON:
{{
  "score": 0,
  "matched_skills": [],
  "missing_skills": [],
  "reasons": [],
  "recommend_apply": false
}}
Score 0-100. Recommend apply if above 60.

CANDIDATE: {json.dumps(resume)}
JOB TITLE: {job.get('title')}
JOB DESCRIPTION: {job.get('description', '')[:800]}
REQUIRED SKILLS: {job.get('tags')}"""}]
    )
    return json.loads(msg.content[0].text.strip())
```

### Resume Tailor

```python
# backend/ai/resume_tailor.py

import anthropic, json

client = anthropic.Anthropic()

async def tailor_resume(original_text: str, job_description: str) -> dict:
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2000,
        messages=[{"role": "user", "content": f"""Tailor this resume for this job.
RULES:
- Never invent skills or experience that are not in the original
- Reorder and reword to match JD keywords
- Only adjust emphasis, not facts
Return ONLY valid JSON:
{{
  "tailored_summary": "",
  "reordered_skills": [],
  "changes_made": [],
  "warnings": ""
}}

ORIGINAL RESUME:
{original_text}

JOB DESCRIPTION:
{job_description}"""}]
    )
    return json.loads(msg.content[0].text.strip())
```

### Q&A Answerer (for application questionnaires)

```python
# backend/ai/qa_answerer.py

import anthropic

client = anthropic.Anthropic()

async def answer_question(question: str, user_profile: dict) -> str:
    msg = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=100,
        messages=[{"role": "user", "content": f"""Answer this job application question
based on the candidate profile. Give a short, direct answer only.
No explanation. No quotes.

QUESTION: {question}
CANDIDATE PROFILE: {user_profile}

Answer:"""}]
    )
    return msg.content[0].text.strip()
```

---

## Phase 9 — Safe Apply Manager (Critical — Do This Right)

```python
# backend/portals/base.py

import time, random, logging
from datetime import datetime, date

logger = logging.getLogger(__name__)

PORTAL_LIMITS = {
    "naukri": 20,
    "foundit": 20,
    "internshala": 30,
    "linkedin": 30,
    "workday": 50,    # company sites — no real limit, be conservative
    "taleo": 50,
    "tcs": 10,
    "infosys": 10,
}

PORTAL_DELAYS = {
    "naukri": (30, 90),
    "foundit": (30, 90),
    "internshala": (20, 60),
    "linkedin": (45, 120),
    "workday": (60, 150),
    "taleo": (60, 150),
    "tcs": (60, 180),
    "infosys": (60, 180),
}

class SafeApplyManager:
    def __init__(self, db):
        self.db = db

    def can_apply(self, user_id: str, portal: str) -> tuple[bool, str]:
        limit = PORTAL_LIMITS.get(portal, 10)
        today_count = self._get_today_count(user_id, portal)

        if today_count >= limit:
            return False, f"Daily limit of {limit} reached for {portal}"

        hour = datetime.now().hour
        if hour < 9 or hour > 20:
            return False, "Outside safe hours — only 9am to 8pm"

        return True, "ok"

    def safe_delay(self, portal: str):
        min_d, max_d = PORTAL_DELAYS.get(portal, (30, 90))
        delay = random.uniform(min_d, max_d)
        logger.info(f"Waiting {delay:.0f}s before next {portal} apply...")
        time.sleep(delay)

    def _get_today_count(self, user_id: str, portal: str) -> int:
        # Query DB: count applications for user_id + portal + today's date
        # Implement with your DB client
        return 0

    def log_application(self, user_id: str, job, resume_url: str = ""):
        # Insert into applications table
        pass
```

---

## Phase 10 — FastAPI Backend + Scheduler (Week 2-3)

### Main app

```python
# backend/main.py

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from api.routes import auth, resume, preferences, jobs, applications, portals

app = FastAPI(title="Job Automation API")
scheduler = AsyncIOScheduler()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth")
app.include_router(resume.router, prefix="/api/resume")
app.include_router(preferences.router, prefix="/api/preferences")
app.include_router(jobs.router, prefix="/api/jobs")
app.include_router(applications.router, prefix="/api/applications")
app.include_router(portals.router, prefix="/api/portals")

@app.on_event("startup")
async def startup():
    scheduler.add_job(daily_job_fetch, "cron", hour=8, minute=0,
                      timezone="Asia/Kolkata")
    scheduler.start()

async def daily_job_fetch():
    # For each user with active tokens:
    # 1. Get preferences
    # 2. Search all connected portals
    # 3. Score jobs with AI
    # 4. Save matches above 60% to DB
    # 5. Notify user
    pass
```

### Key API routes

```
POST /api/resume/upload           Upload + parse PDF
GET  /api/resume/parsed           Get parsed data

POST /api/preferences             Save preferences
GET  /api/preferences             Get preferences

POST /api/portals/naukri/token    Save Naukri bearer token
POST /api/portals/linkedin/setup  Instructions for Chrome profile setup
GET  /api/portals/status          Which portals are connected

GET  /api/jobs/matches            Today's scored matches
POST /api/jobs/{id}/approve       Queue job for applying
POST /api/jobs/{id}/skip          Remove from queue
POST /api/jobs/{id}/tailor        Generate tailored resume (returns diff)
POST /api/jobs/{id}/apply         Apply to approved job

GET  /api/applications            All applications
PATCH /api/applications/{id}      Update status manually
```

---

## Phase 11 — React Frontend (Week 4)

### Setup

```bash
cd frontend
npx create-react-app . --template typescript
npm install @tailwindcss/forms axios react-router-dom react-dropzone
```

### 4 pages to build

**Page 1: Onboarding**
- PDF drag-and-drop upload
- Show parsed resume data (confirm/edit)
- Skills editor
- Preferences form: job titles, locations, work type, salary slider

**Page 2: Portal Connect**
- Card per portal (Naukri, LinkedIn, Foundit, Internshala)
- Naukri/Foundit: paste Bearer token instructions
- LinkedIn: Chrome profile setup guide
- Show connected / expired status

**Page 3: Dashboard**
- Today's job matches
- Each card: match score, title, company, location, skills matched
- Approve / Skip / Tailor Resume buttons
- Tailor Resume opens a diff modal (before/after comparison)
- Apply button (after approval)

**Page 4: Tracker**
- Kanban board: Applied → Viewed → Interview → Rejected
- Click any card for details
- Update status manually

### API client

```javascript
// frontend/src/api/client.js

import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:8000' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const resumeAPI = {
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/api/resume/upload', form,
      { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  getParsed: () => api.get('/api/resume/parsed'),
};

export const jobsAPI = {
  getMatches:   ()   => api.get('/api/jobs/matches'),
  approve:      (id) => api.post(`/api/jobs/${id}/approve`),
  skip:         (id) => api.post(`/api/jobs/${id}/skip`),
  tailorResume: (id) => api.post(`/api/jobs/${id}/tailor`),
  apply:        (id) => api.post(`/api/jobs/${id}/apply`),
};

export const applicationsAPI = {
  getAll:       ()            => api.get('/api/applications'),
  updateStatus: (id, status)  => api.patch(`/api/applications/${id}`, { status }),
};
```

---

## Common Errors and Fixes

| Error | Portal | Cause | Fix |
|---|---|---|---|
| 403 on job search | Naukri | nkparam wrong | Re-generate nkparam |
| 401 Unauthorized | Naukri/Foundit | Token expired | Re-login, save new token |
| 429 Too Many Requests | Any | Applying too fast | Increase delays |
| CAPTCHA appears | LinkedIn | Bot detected | Use slower delays, fewer applies |
| Session invalidated | Naukri | IP changed | Use Elastic IP only |
| iframe not found | Taleo | Wrong frame context | Switch to correct iframe |
| Easy Apply not shown | LinkedIn | Job has external apply | Skip this job |
| Form submit fails | Workday | Required field empty | Check AI answer for that field |

---

## Testing Checklist Per Portal

### Naukri
- [ ] Login returns Bearer token
- [ ] Recommended jobs returns results
- [ ] Search with keyword + location returns results
- [ ] nkparam generates correctly (no 403)
- [ ] Apply to 1 real job works

### Foundit
- [ ] Login works with email + password
- [ ] Job search returns results
- [ ] Apply works

### Internshala
- [ ] Login captures session cookie
- [ ] Internship search returns results
- [ ] Playwright apply fills and submits form

### LinkedIn
- [ ] Chrome profile loads with existing session
- [ ] Job search intercepts API response
- [ ] Easy Apply walks through all form steps
- [ ] Stops at daily limit of 30

### Workday
- [ ] Correctly identifies Workday jobs from company sites
- [ ] Form fill handles text, dropdowns, file upload
- [ ] Works on at least 3 different company Workday instances

### TCS / Infosys
- [ ] Can search jobs on career portal
- [ ] Can navigate to job detail page
- [ ] Apply form completes and submits

---

## Phase 12 — Company Portals With Account Login (Week 7-8)

Some company career portals require the user to have a registered account
before they can apply. Examples: TCS iBegin, Infosys, Cognizant, Wipro careers.

### Chosen Approach: Option 1 — Pre-created Account

```
The user creates the account ONCE manually on the company site.
They save their credentials in your app (encrypted).
Your app logs in automatically using those saved credentials.
Playwright handles the session and applies on their behalf.

Why this is correct:
- Real person, real account — not fake
- Same as how a password manager works
- No CAPTCHA problem (user created account themselves)
- No email verification problem (already done by user)
- Lower ban risk than any automated account creation
```

### Step 12.1 — Database Table for Company Accounts

Add this to your Supabase SQL:

```sql
create table public.company_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  company_key text,            -- 'tcs', 'infosys', 'cognizant', 'wipro'
  company_name text,
  login_url text,
  signup_url text,             -- shown to user so they can create account
  username text,               -- usually their email
  password_encrypted text,     -- AES-256 encrypted, NEVER plain text
  account_status text default 'needs_setup',
                               -- 'needs_setup', 'active', 'manual_only', 'expired'
  chrome_profile_dir text,     -- separate Playwright profile per company
  last_login_at timestamp,
  created_at timestamp default now(),
  unique(user_id, company_key)
);
```

### Step 12.2 — Encryption Utility

This is the most security-critical file in your entire codebase.

```python
# backend/core/encryption.py

from cryptography.fernet import Fernet
import os

# ENCRYPTION_KEY must be in .env — never hardcode it
# Generate once with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Then paste into .env as ENCRYPTION_KEY=<value>

_fernet = None

def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.getenv("ENCRYPTION_KEY")
        if not key:
            raise RuntimeError("ENCRYPTION_KEY not set in environment")
        _fernet = Fernet(key.encode())
    return _fernet

def encrypt_password(plain_text: str) -> str:
    return _get_fernet().encrypt(plain_text.encode()).decode()

def decrypt_password(encrypted_text: str) -> str:
    return _get_fernet().decrypt(encrypted_text.encode()).decode()
```

Security rules — follow these strictly:
```
✅ Encrypt before saving to DB
✅ Decrypt only at the moment of login — nowhere else
✅ ENCRYPTION_KEY only in .env — never in code or git
✅ Never log decrypted password anywhere — not even debug logs
✅ Never return password field in any API response
✅ Add "Delete all my credentials" option in settings
✅ Use HTTPS in production — never HTTP

❌ Never store plain text password
❌ Never put ENCRYPTION_KEY in source code
❌ Never expose password in API response JSON
```

### Step 12.3 — Company Portal Registry

```python
# backend/portals/custom/registry.py

# Central registry of all company portals that need accounts.
# Add new companies here as you support them.
# Selectors are best guesses — verify with DevTools for each site.

COMPANY_PORTALS = {
    "tcs": {
        "name": "TCS iBegin",
        "signup_url": "https://ibegin.tcs.com/iBegin/",
        "login_url": "https://ibegin.tcs.com/iBegin/",
        "username_selector": "input[name='email'], input[id='email']",
        "password_selector": "input[type='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".dashboard, .home, #profile",  # element visible after login
        "chrome_profile_subdir": "tcs",
    },
    "infosys": {
        "name": "Infosys Careers",
        "signup_url": "https://career.infosys.com/register",
        "login_url": "https://career.infosys.com/login",
        "username_selector": "input[name='email']",
        "password_selector": "input[name='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".candidate-dashboard, .profile-section",
        "chrome_profile_subdir": "infosys",
    },
    "cognizant": {
        "name": "Cognizant Careers",
        "signup_url": "https://careers.cognizant.com/global/en/register",
        "login_url": "https://careers.cognizant.com/global/en/login",
        "username_selector": "input[type='email']",
        "password_selector": "input[type='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".logged-in, .account-nav",
        "chrome_profile_subdir": "cognizant",
    },
    "wipro": {
        "name": "Wipro Careers",
        "signup_url": "https://careers.wipro.com/careers-home/",
        "login_url": "https://careers.wipro.com/careers-home/",
        "username_selector": "input[type='email']",
        "password_selector": "input[type='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".loggedin-nav, .user-account",
        "chrome_profile_subdir": "wipro",
    },
    "hcl": {
        "name": "HCL Careers",
        "signup_url": "https://www.hcltech.com/careers",
        "login_url": "https://hcl.taleo.net/careersection/hcl_professional/jobsearch.ftl",
        "username_selector": "input[name='j_username']",
        "password_selector": "input[name='j_password']",
        "submit_selector": "input[type='submit'], button[type='submit']",
        "success_indicator": ".candidate-dashboard",
        "chrome_profile_subdir": "hcl",
    },
}
```

### Step 12.4 — Account Login Handler (Playwright)

```python
# backend/portals/custom/account_login.py

from playwright.async_api import async_playwright
from core.encryption import decrypt_password
import asyncio
import logging

logger = logging.getLogger(__name__)

BASE_PROFILE_DIR = "./chrome_profiles/companies"

async def login_to_company_portal(
    company_key: str,
    username: str,
    password_encrypted: str,
) -> dict:
    """
    Logs into a company portal using saved credentials.
    Returns: { success: bool, reason: str }
    Uses persistent Chrome profile so session is reused next time.
    """
    from .registry import COMPANY_PORTALS
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return {"success": False, "reason": f"Unknown company: {company_key}"}

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"
    password = decrypt_password(password_encrypted)  # decrypt only here

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False  # visible — easier to handle unexpected popups
        )
        page = await browser.new_page()

        try:
            await page.goto(company["login_url"])
            await page.wait_for_timeout(2000)

            # Check if already logged in from saved session
            already_logged_in = await page.query_selector(
                company["success_indicator"]
            )
            if already_logged_in:
                logger.info(f"Already logged in to {company['name']}")
                await browser.close()
                return {"success": True, "reason": "Session still active"}

            # Fill username
            await page.fill(company["username_selector"], username)
            await page.wait_for_timeout(500)

            # Fill password — decrypt only at point of use
            await page.fill(company["password_selector"], password)
            del password  # clear from memory immediately after use
            await page.wait_for_timeout(500)

            # Submit
            await page.click(company["submit_selector"])
            await page.wait_for_timeout(3000)

            # Verify login succeeded
            logged_in = await page.query_selector(company["success_indicator"])
            if logged_in:
                logger.info(f"Login successful: {company['name']}")
                await browser.close()
                return {"success": True, "reason": "Logged in successfully"}
            else:
                current_url = page.url
                await browser.close()
                return {
                    "success": False,
                    "reason": f"Login may have failed. Current URL: {current_url}"
                }

        except Exception as e:
            await browser.close()
            logger.error(f"Login error for {company['name']}: {e}")
            return {"success": False, "reason": str(e)}


async def is_session_active(company_key: str) -> bool:
    """Quick check if existing Chrome profile session is still valid."""
    from .registry import COMPANY_PORTALS
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return False

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=True
        )
        page = await browser.new_page()
        await page.goto(company["login_url"])
        await page.wait_for_timeout(2000)
        logged_in = await page.query_selector(company["success_indicator"])
        await browser.close()
        return bool(logged_in)
```

### Step 12.5 — Apply Flow Using Saved Account

```python
# backend/portals/custom/company_apply.py

from playwright.async_api import async_playwright
from .account_login import login_to_company_portal, is_session_active
from .registry import COMPANY_PORTALS
from backend.ai.qa_answerer import answer_question
import asyncio, random

BASE_PROFILE_DIR = "./chrome_profiles/companies"

async def apply_with_company_account(
    company_key: str,
    job_url: str,
    resume_path: str,
    user_profile: dict,
    username: str,
    password_encrypted: str,
) -> dict:
    """
    Full flow:
    1. Check if session is still active
    2. If not — log in again using saved credentials
    3. Navigate to job URL
    4. Fill and submit application form
    """
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return {"success": False, "reason": "Unknown company"}

    # Step 1: Ensure we are logged in
    session_ok = await is_session_active(company_key)
    if not session_ok:
        login_result = await login_to_company_portal(
            company_key, username, password_encrypted
        )
        if not login_result["success"]:
            return {"success": False, "reason": f"Login failed: {login_result['reason']}"}

    # Step 2: Apply
    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False
        )
        page = await browser.new_page()
        await page.goto(job_url)
        await page.wait_for_timeout(2000)

        # Find and click Apply button
        apply_selectors = [
            "button:has-text('Apply')",
            "a:has-text('Apply Now')",
            "button:has-text('Apply Now')",
            "input[value='Apply']",
        ]
        clicked = False
        for selector in apply_selectors:
            try:
                await page.click(selector, timeout=3000)
                clicked = True
                break
            except:
                continue

        if not clicked:
            await browser.close()
            return {"success": False, "reason": "No Apply button found on job page"}

        await page.wait_for_timeout(2000)

        # Walk through multi-step form
        for step in range(15):
            await page.wait_for_timeout(1500)

            # Upload resume if file input appears
            file_input = await page.query_selector("input[type='file']")
            if file_input:
                await file_input.set_input_files(resume_path)
                await page.wait_for_timeout(1000)

            # Fill text fields using AI
            inputs = await page.query_selector_all(
                "input[type='text']:not([readonly]), input[type='tel'], textarea"
            )
            for inp in inputs:
                val = await inp.input_value()
                if val:
                    continue  # already filled
                label = (await inp.get_attribute("aria-label") or
                         await inp.get_attribute("placeholder") or
                         await inp.get_attribute("name") or "")
                if label:
                    answer = await answer_question(label, user_profile)
                    if answer:
                        await inp.fill(answer)
                        await page.wait_for_timeout(300)

            # Handle dropdowns
            selects = await page.query_selector_all("select")
            for sel in selects:
                current = await sel.input_value()
                if not current:
                    try:
                        await sel.select_option(index=1)
                    except:
                        pass

            # Check for submit or next
            submit = await page.query_selector(
                "button:has-text('Submit'), input[type='submit'], "
                "button:has-text('Apply'), button[type='submit']"
            )
            next_btn = await page.query_selector(
                "button:has-text('Next'), button:has-text('Continue'), "
                "button:has-text('Save & Continue')"
            )

            if submit:
                await submit.click()
                await page.wait_for_timeout(2000)
                await browser.close()
                # Human-like delay after applying
                await asyncio.sleep(random.uniform(60, 180))
                return {"success": True}
            elif next_btn:
                await next_btn.click()
            else:
                break

        await browser.close()
        return {"success": False, "reason": "Could not complete application form"}
```

### Step 12.6 — API Endpoints for Company Accounts

```python
# backend/api/routes/company_accounts.py

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from core.encryption import encrypt_password
from portals.custom.account_login import is_session_active

router = APIRouter()

class CompanyAccountIn(BaseModel):
    company_key: str
    username: str
    password: str          # plain text from frontend — encrypted immediately

class CompanyAccountUpdate(BaseModel):
    account_status: str    # 'active', 'manual_only'

@router.post("/company-accounts")
async def save_company_account(body: CompanyAccountIn):
    # Encrypt password immediately — never store plain text
    encrypted = encrypt_password(body.password)

    # Save to DB: company_key, username, encrypted password
    # Return success — never return the password back
    return {"success": True, "company": body.company_key}

@router.get("/company-accounts")
async def get_company_accounts():
    # Return list of connected companies
    # NEVER include password or password_encrypted in response
    return {"accounts": [
        {"company_key": "tcs", "company_name": "TCS iBegin",
         "status": "active", "username": "user@email.com"}
    ]}

@router.get("/company-accounts/{company_key}/status")
async def check_session_status(company_key: str):
    active = await is_session_active(company_key)
    return {"company_key": company_key, "session_active": active}

@router.delete("/company-accounts/{company_key}")
async def delete_company_account(company_key: str):
    # Delete from DB + delete Chrome profile folder
    # User's right to remove their data
    return {"success": True, "deleted": company_key}
```

### Step 12.7 — Frontend UI for Company Account Setup

What the "Connect Company Account" screen looks like per company:

```
┌─────────────────────────────────────────────────┐
│  TCS iBegin                          ⚠ Not set  │
│                                                 │
│  This portal requires a registered account.     │
│                                                 │
│  Step 1: Create your account on TCS iBegin      │
│          → https://ibegin.tcs.com  [Open ↗]    │
│                                                 │
│  Step 2: Enter your credentials below           │
│  Email:     [________________________]          │
│  Password:  [________________________]          │
│                                                 │
│  Your password is encrypted before saving.      │
│  We never store or transmit plain text.         │
│                                [Save & Connect] │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Infosys Careers                     ✓ Connected│
│  Account: john@email.com                        │
│  Session: Active (last used 3 hours ago)        │
│                          [Test] [Disconnect]    │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  Cognizant Careers              ○ Manual Only   │
│                                                 │
│  App will find jobs but you apply manually.     │
│       [Connect Account Instead]                 │
└─────────────────────────────────────────────────┘
```

### Step 12.8 — Testing Checklist for Company Accounts

- [ ] Password is encrypted before it hits the database
- [ ] Decrypted password never appears in any log or API response
- [ ] Login to TCS iBegin works with saved credentials
- [ ] Session check correctly returns true when already logged in
- [ ] Session check returns false when session is expired
- [ ] Re-login triggers automatically when session expired
- [ ] Apply form fills and submits on TCS
- [ ] Apply form fills and submits on Infosys
- [ ] Delete account removes credentials and Chrome profile
- [ ] Frontend never displays the stored password back to user

---

## Implementation Order (Week by Week)

```
Week 1:   DevTools study → Naukri API client → test script passes
Week 2:   FastAPI setup → Supabase schema → resume upload + parser
Week 3:   Job scorer + tailor → Foundit client → scheduler setup
Week 4:   React frontend → all 4 pages → full Naukri flow end to end
Week 5:   LinkedIn Playwright → Internshala → connect to frontend
Week 6:   Workday automation → test on Wipro, IBM, Capgemini
Week 7:   Taleo → TCS iBegin → Infosys careers
Week 8:   Company accounts (Phase 12) → encrypt credentials →
          login handler → apply flow → frontend connect UI
Week 9:   End to end testing all portals → bug fixes → deploy AWS EC2
```

Do not skip ahead. Each phase builds on the previous one.

---

## Complete Tools Reference

Every tool relevant to this project, researched and categorised.
For each tool: what it is, where it fits, whether to use it, and why.

---

### Category 1 — Browser Automation (For Form Filling + Applying)

---

#### Playwright ✅ PRIMARY TOOL
```
What:     Microsoft's browser automation library. Controls real Chrome/Firefox.
Use for:  LinkedIn Easy Apply, Internshala apply, Workday forms,
          Taleo forms, company portal login, any form interaction.
Why best: Native async support, built-in network interception,
          persistent context, fastest of all browser tools.
Install:  pip install playwright && playwright install chromium
Docs:     https://playwright.dev/python/
```

---

#### Nodriver ✅ USE FOR HEAVILY PROTECTED SITES
```
What:     Async Chrome automation WITHOUT WebDriver protocol.
          Communicates with Chrome via raw DevTools Protocol directly.
          Created by the same author as undetected-chromedriver.
Why special: Standard Playwright/Selenium inject WebDriver markers
             that anti-bot systems detect. Nodriver never injects them.
Benchmark: Wins outright with zero blocked targets across 31 test sites
           (2026 anti-detect browser benchmark).
Use for:  Sites that block standard Playwright — Indeed India,
          any site with aggressive bot detection.
Install:  pip install nodriver
Docs:     https://github.com/ultrafunkamsterdam/nodriver
```

Example:
```python
import nodriver as uc
import asyncio

async def scrape_protected_site():
    browser = await uc.start()
    page = await browser.get("https://indeed.co.in/jobs")
    await page.wait(3)
    jobs = await page.query_selector_all(".job-card")
    for job in jobs:
        print(await job.text())
    browser.stop()

asyncio.run(scrape_protected_site())
```

---

#### Camoufox ⚠️ USE ONLY IF NODRIVER FAILS
```
What:     Firefox modified at C++ source level to spoof fingerprints.
          Not a patch — actually rewrites the browser engine.
Why it exists: Anti-bot systems detect JS-level patches.
               Camoufox patches below JavaScript — undetectable.
Detection score: 0% headless detection on CreepJS and similar tests.
Tradeoff: Firefox only. Some sites serve different content to Firefox.
          Smaller community than Playwright.
Use for:  Last resort when Nodriver and Playwright both fail.
Install:  pip install camoufox && python -m camoufox fetch
Docs:     https://github.com/daijro/camoufox
```

Example:
```python
from camoufox.sync_api import Camoufox

with Camoufox(humanize=True) as browser:
    page = browser.new_page()
    page.goto("https://protected-site.com/careers")
    jobs = page.query_selector_all(".job-item")
```

---

#### Selenium ❌ SKIP
```
Legacy tool. Playwright is strictly better in every way.
Only relevant for reading old reference repos — rewrite their
logic in Playwright, do not use Selenium itself.
```

---

### Category 2 — HTTP Requests (For Direct API Calls)

---

#### httpx ✅ PRIMARY for FastAPI integration
```
What:     Async HTTP client. Drop-in replacement for requests.
Why use:  FastAPI is fully async. Using sync requests inside async
          endpoints blocks the event loop. httpx is async-native.
Use for:  Naukri API calls, Foundit API calls, Internshala API calls
          inside FastAPI route handlers.
Install:  pip install httpx
```

Example:
```python
import httpx

async def search_naukri_jobs(token: str, keyword: str):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://www.naukri.com/jobapi/v3/search",
            params={"keyword": keyword},
            headers={"Authorization": f"Bearer {token}"}
        )
        return response.json()
```

---

#### requests ✅ USE for scripts and testing
```
What:     Synchronous HTTP client. The standard Python library for HTTP.
Use for:  Local test scripts, one-off API testing, non-async contexts.
          Fine for Phase 1 testing before integrating into FastAPI.
Install:  pip install requests (usually pre-installed)
```

---

#### curl_cffi ✅ USE when httpx gets blocked
```
What:     Python bindings for curl with browser TLS fingerprint impersonation.
          Impersonates Chrome/Firefox at the TLS handshake level.
Why matters: Some sites check TLS fingerprint (JA3 hash).
             Python's requests/httpx have a Python TLS fingerprint —
             mismatch with claimed User-Agent triggers detection.
             curl_cffi sends an actual Chrome TLS fingerprint.
Use for:  Naukri or Foundit if they start blocking httpx requests.
Install:  pip install curl_cffi
```

Example:
```python
from curl_cffi import requests as cffi_requests

response = cffi_requests.get(
    "https://www.naukri.com/jobapi/v3/search",
    impersonate="chrome120",   # sends real Chrome TLS fingerprint
    headers={"Authorization": "Bearer <token>"}
)
```

---

### Category 3 — Scraping (For Reading Company Career Pages)

---

#### Scrapling ✅ USE for reading company job listing pages
```
What:     Adaptive scraping framework. 52k stars on GitHub.
          CSS/XPath selectors that survive website redesigns.
          StealthyFetcher bypasses Cloudflare automatically.
          BSD-3-Clause license — fully commercial friendly.
Use for:  Reading job listings from company career pages that
          have no standard API. Finding new jobs to apply to.
          Sites with Cloudflare protection.
NOT for:  Filling forms, clicking buttons, applying to jobs —
          use Playwright for anything interactive.
Install:  pip install "scrapling[fetchers]" && scrapling install
Docs:     https://github.com/D4Vinci/Scrapling
```

Example — reading job listings from a company site:
```python
from scrapling.fetchers import StealthyFetcher

# auto_save=True means selectors survive site redesigns
page = StealthyFetcher.fetch(
    "https://careers.somecompany.com/jobs",
    headless=True,
    network_idle=True
)

jobs = page.css(".job-listing", auto_save=True)
for job in jobs:
    print(job.css(".title::text").get())
    print(job.css(".location::text").get())
    print(job.css("a::attr(href)").get())
```

---

#### BeautifulSoup ❌ SKIP
```
Only works on static HTML. All major job portals use JavaScript
rendering. BeautifulSoup sees empty shells, not job data.
Playwright or Scrapling handle everything BS4 does, and more.
```

---

#### Scrapy ❌ SKIP
```
Industrial crawler for thousands of pages. Complete overkill.
You are making targeted API calls and applying to 20 jobs/day —
not crawling millions of pages. Adds unnecessary complexity.
```

---

### Category 4 — PDF Processing (For Resume Parsing)

---

#### pdfplumber ✅ RECOMMENDED for resume parsing
```
What:     PDF text extraction with layout awareness.
          Best for extracting structured text while preserving
          column layouts and formatting — ideal for resumes.
License:  MIT — commercial friendly.
Use for:  Primary resume PDF text extraction before sending to AI.
Install:  pip install pdfplumber
```

Example:
```python
import pdfplumber

def extract_resume_text(pdf_path: str) -> str:
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += page.extract_text() or ""
    return text
```

---

#### PyMuPDF (fitz) ⚠️ FAST but check license
```
What:     Fastest PDF library — 0.1s average extraction time.
          Significantly faster than pdfplumber.
License:  AGPL-3.0 — requires open-sourcing your code OR
          buying a commercial license. Check carefully for SaaS.
Use for:  If you need speed at scale (many users simultaneously).
          Get commercial license if building paid product.
Install:  pip install pymupdf
```

---

#### pypdf ✅ FALLBACK option
```
What:     Pure Python PDF library. No external dependencies.
          Slower than PyMuPDF but simpler and MIT licensed.
License:  BSD-3-Clause — fully commercial friendly.
Use for:  Fallback when pdfplumber fails on a specific resume format.
Install:  pip install pypdf
```

#### Decision for your project:
```
Start with pdfplumber — best balance of accuracy and license.
If a resume fails to parse correctly → try pypdf as fallback.
If you need speed at scale later → evaluate PyMuPDF commercial license.
```

---

### Category 5 — Task Queue + Scheduling

---

#### APScheduler ✅ USE for MVP (already in plan)
```
What:     In-process Python job scheduler. Runs cron jobs inside
          your FastAPI app. No extra infrastructure needed.
Use for:  Daily job fetch at 8am IST. Simple, zero setup.
When to replace: When you have multiple users running simultaneously
                 and need jobs distributed across workers.
Install:  pip install apscheduler
```

---

#### Celery + Redis ✅ USE when scaling beyond single user
```
What:     Celery = distributed task queue (industry standard).
          Redis = message broker + result backend.
          Together: background jobs that run independently of
          your FastAPI app, with retry on failure, monitoring,
          and horizontal scaling.
Use for:  When APScheduler is not enough:
          - Multiple users, parallel job fetches
          - Long-running Playwright sessions (5+ minutes)
          - Retry failed apply attempts automatically
          - Job apply queue per user
When to add: Month 2 onwards when you have real users.
Install:  pip install celery redis
```

Example:
```python
# tasks.py
from celery import Celery

app = Celery('job_automation',
             broker='redis://localhost:6379/0',
             backend='redis://localhost:6379/1')

@app.task(bind=True, max_retries=3)
def apply_to_job(self, user_id: str, job_id: str):
    try:
        # run the apply logic here
        result = run_apply(user_id, job_id)
        return result
    except Exception as exc:
        # auto retry after 60 seconds, up to 3 times
        raise self.retry(exc=exc, countdown=60)

# Scheduled daily fetch
app.conf.beat_schedule = {
    'daily-job-fetch': {
        'task': 'tasks.fetch_all_users_jobs',
        'schedule': crontab(hour=8, minute=0),
    }
}
```

---

### Category 6 — Notifications

---

#### Twilio WhatsApp API ✅ IN PLAN
```
What:     Send WhatsApp messages programmatically.
Use for:  Token expiry alerts, interview call notifications,
          daily job match summary.
Cost:     ~₹0.60-1 per message. Free sandbox for testing.
Install:  pip install twilio
Docs:     https://www.twilio.com/whatsapp
```

---

#### Resend ✅ IN PLAN
```
What:     Modern email API. Developer-friendly, free tier 3000/month.
Use for:  Application confirmation emails, daily digest, welcome email.
Install:  pip install resend
Docs:     https://resend.com
```

---

#### Firebase Cloud Messaging (FCM) ⚠️ OPTIONAL
```
What:     Push notifications to mobile/web browsers.
Use for:  If you build a mobile app or PWA later.
          Real-time "You got an interview call!" notification.
Cost:     Free.
Add in:   Month 3+ if you add a mobile app.
```

---

### Category 7 — Anti-Detection Utilities

---

#### fake-useragent ✅ USE
```
What:     Generates realistic, rotating browser User-Agent strings.
Use for:  Every HTTP request — rotate User-Agent to avoid fingerprinting.
Install:  pip install fake-useragent
```

```python
from fake_useragent import UserAgent
ua = UserAgent()
headers = {"User-Agent": ua.chrome}  # random real Chrome UA
```

---

#### python-anticaptcha / 2captcha ⚠️ OPTIONAL
```
What:     Paid CAPTCHA solving services. Send CAPTCHA image →
          get solution back in seconds via human solvers or AI.
Services: 2captcha (~$3/1000 solves), Anti-Captcha (similar pricing)
Use for:  ONLY if CAPTCHA appears during Playwright automation.
          Most portals won't show CAPTCHA if you use persistent
          Chrome profile and human-like delays.
Cost:     Small — budget ₹500/month max.
Add only: When you actually encounter CAPTCHA problems.
Install:  pip install 2captcha-python
```

---

#### random + time (built-in) ✅ ALREADY IN PLAN
```
What:     Python standard library. Used for human-like delays.
Use for:  random.uniform(30, 90) between every apply action.
          Already in the SafeApplyManager code above.
No install needed.
```

---

### Category 8 — Data and Storage

---

#### Supabase Python SDK ✅ IN PLAN
```
What:     Python client for Supabase (PostgreSQL + Auth + Storage).
Use for:  All database operations, file storage (resumes),
          user authentication.
Install:  pip install supabase
Docs:     https://supabase.com/docs/reference/python
```

---

#### Redis ✅ ADD in Month 2
```
What:     In-memory key-value store.
Use for:  Session token caching (faster than hitting DB every request),
          Celery broker when you add task queue,
          rate limit counters per user per portal.
Install:  pip install redis
          Docker: docker run -p 6379:6379 redis
```

---

#### cryptography ✅ IN PLAN (for password encryption)
```
What:     Python cryptography library. Used for AES-256 Fernet encryption.
Use for:  Encrypting company portal passwords at rest (Phase 12).
Install:  pip install cryptography
```

---

### Category 9 — Resume Generation (For Tailored Resumes)

---

#### python-docx ✅ USE for generating tailored resumes
```
What:     Create and edit .docx Word files programmatically.
Use for:  When AI tailors the resume — generate a new .docx file
          with the tailored content for the user to download/use.
Install:  pip install python-docx
```

---

#### ReportLab / WeasyPrint ⚠️ OPTIONAL for PDF generation
```
What:     Generate PDF files from Python.
Use for:  If you want to generate tailored resumes as PDF directly.
          WeasyPrint converts HTML → PDF (easier to control styling).
Install:  pip install weasyprint
Note:     Most job portals accept PDF resumes. Worth adding in Month 2.
```

---

### Full Tools Summary Table

| Tool | Category | Use in project | Priority |
|---|---|---|---|
| Playwright | Browser automation | LinkedIn, Workday, Taleo, forms | ✅ Week 1 |
| httpx | HTTP client | Naukri, Foundit APIs in FastAPI | ✅ Week 1 |
| requests | HTTP client | Local testing and scripts | ✅ Week 1 |
| pdfplumber | PDF parsing | Resume text extraction | ✅ Week 2 |
| APScheduler | Scheduling | Daily job fetch cron | ✅ Week 3 |
| Supabase SDK | Database | All data storage | ✅ Week 2 |
| cryptography | Encryption | Company passwords at rest | ✅ Week 7 |
| python-docx | Resume generation | Tailored resume output | ✅ Week 3 |
| Twilio | Notifications | WhatsApp alerts | ✅ Week 4 |
| Resend | Notifications | Email notifications | ✅ Week 4 |
| fake-useragent | Anti-detection | Rotate User-Agent headers | ✅ Week 1 |
| Scrapling | Adaptive scraping | Company career page reading | ✅ Week 6 |
| Nodriver | Stealth browser | Heavily protected sites | ⚠️ When needed |
| curl_cffi | TLS fingerprint | If httpx gets blocked | ⚠️ When needed |
| Celery + Redis | Task queue | Multi-user job scheduling | ⚠️ Month 2 |
| Camoufox | Maximum stealth | Last resort anti-detection | ⚠️ If Nodriver fails |
| 2captcha | CAPTCHA solving | If CAPTCHA appears | ⚠️ If needed |
| WeasyPrint | PDF generation | Tailored resume as PDF | ⚠️ Month 2 |
| Firebase FCM | Push notifications | Mobile app notifications | ⚠️ Month 3 |
| Selenium | Browser automation | ❌ Skip — use Playwright | ❌ Never |
| BeautifulSoup | HTML parsing | ❌ Skip — use Scrapling | ❌ Never |
| Scrapy | Web crawling | ❌ Overkill for this project | ❌ Never |
| Rotating proxies | IP rotation | ❌ Breaks Naukri sessions | ❌ Never |

---

### Install All MVP Tools at Once

```bash
# Core backend
pip install fastapi uvicorn httpx requests python-dotenv

# Database and auth
pip install supabase

# Browser automation
pip install playwright && playwright install chromium

# PDF processing
pip install pdfplumber pypdf python-docx

# AI
pip install anthropic

# Scheduling
pip install apscheduler

# Security
pip install cryptography

# Anti-detection
pip install fake-useragent

# Scraping (for company career pages)
pip install "scrapling[fetchers]" && scrapling install

# Notifications
pip install twilio resend

# Add later (Month 2):
# pip install celery redis nodriver curl_cffi
```

---

## How to Use This Document With AI

Feed this whole file to any AI assistant and ask specific questions:

- "Help me implement the Naukri auth client in Step 1.3"
- "I'm getting 403 on Naukri job search — help me debug nkparam"
- "Help me write the Workday generic form handler in Phase 5"
- "My LinkedIn Easy Apply gets stuck on step 3 — help me fix it"
- "Help me write the job scorer prompt in Phase 8"
- "How do I handle the iframe in Taleo apply?"
- "Help me implement the encryption utility in Phase 12 Step 12.2"
- "My company portal login is not detecting the success indicator — help me fix it"
- "How do I add a new company to the registry in Phase 12?"

The more specific your question, the better the answer you get.
