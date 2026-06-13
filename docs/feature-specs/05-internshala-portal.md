# Feature Spec 05 — Internshala Portal

## What This Is

Integration with Internshala.com — the primary portal for internships and fresher jobs in India. Used for unauthenticated public search and Playwright browser automation for the application form. Reuses the `Job` dataclass from the Naukri module.

> **Implementation note (June 2026).** Internshala is now wired into live multi-portal manual search (Naukri + Foundit + Internshala). Two things differ from the original plan:
> - **Search is SEO-path based, not query params.** The old `/jobs/ajax?search_po=…&location_po=…` params returned unfiltered junk. Free-text keyword search uses the `keywords-` path prefix: `/{section}/keywords-<kw>-in-<loc>/ajax/` (e.g. `/jobs/keywords-react-developer-in-mumbai/ajax/`). The `/ajax/` suffix returns the compact job-card fragment parsed by `_parse_html`. No login needed. Page-1 only (the fragment has no reliable pagination). See `portals/internshala/jobs.py::_search_by_path`.
> - **Two ids per listing.** The 7-digit `internshipid` (card attribute) vs the 10-digit detail-URL id (end of the title href). Only the **10-digit** id also appears on the "My Applications" page, so `job_id` is keyed on it for applied-status matching.

## Applied-Status Auto-Detect — REMOVED (manual-confirm only)

> **Update (June 2026, production-only cleanup).** The browser-based applied-status
> detector was **removed**. Internshala's API login is reCAPTCHA-gated (risk-based — real
> browsers pass invisibly, but a headless `requests` login is challenged), so the only
> detector option was scraping a **server-side persistent Chrome profile** with Playwright —
> which can't run on a hosted server (the browser would open on the server, not the user's
> screen, and one profile dir can't serve many users). The deleted pieces were
> `portals/internshala/applied.py`, `services/internshala_apply_sync.py`, the
> `POST /api/applications/sync-internshala` route, `setup_browser_session.py`, and the
> `chrome_profiles/internshala` profile.
>
> **Internshala applied-status is now manual** — the one-tap "I applied" / "Could not apply"
> confirm in Tracker. Search (public, unauthenticated) and Open-portal via the manual login
> link are unaffected and still work in production.
>
> Re-enabling auto-detect later means picking a server-compatible approach (Gmail
> email-parsing, a browser extension, or a remote cloud browser). The full rationale +
> options/drawbacks live in `docs/context/production-readiness.md` → "Applied-status
> auto-detect in production".

## Prerequisites

- `03-naukri-portal.md` complete (reuses `Job` dataclass)
- `02-core-backend-setup.md` complete (Playwright installed)
- A real Internshala account for testing
- Chrome DevTools study of Internshala's network calls
- `portals/internshala/` directory inside `backend/`
- `chrome_profiles/internshala/` directory for persistent browser session

## Environment Variables Needed

```
INTERNSHALA_EMAIL=your_internshala_email
INTERNSHALA_PASSWORD=your_internshala_password
```

---

## Implementation Steps

### Step 1 — DevTools Study

1. Open Chrome → `internshala.com` → login
2. DevTools → Network → Fetch/XHR
3. Capture:

```
LOGIN
  URL: POST https://internshala.com/login/submit_login
  Content-Type: application/x-www-form-urlencoded
  Body fields: email, password (+ possible CSRF token)
  Response: check for success flag or redirect

INTERNSHIP SEARCH
  URL: GET https://internshala.com/internships/ajax
  Params: search_po (keyword), location_po (location)
  Response: look for internships_meta or data object

JOB SEARCH (for full-time jobs)
  URL: GET https://internshala.com/jobs/ajax
  Params: search_po, location_po
  Response: look for jobs_meta or data object
```

Also check: does the login page have a CSRF token in a hidden input or cookie?

---

### Step 2 — `backend/portals/internshala/auth.py`

```python
import requests
from dataclasses import dataclass
from bs4 import BeautifulSoup  # pip install beautifulsoup4 -- for CSRF extraction only

INTERNSHALA_BASE = "https://internshala.com"

@dataclass
class InternshalaSession:
    csrf_token: str
    session_id: str

class InternshalaAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
        })
        self.csrf_token: str = ""

    def _get_csrf_token(self) -> str:
        """Fetch the login page and extract the CSRF token."""
        resp = self.session.get(f"{INTERNSHALA_BASE}/login")
        # Try cookie first
        csrf = self.session.cookies.get("csrf_token") or self.session.cookies.get("csrftoken")
        if csrf:
            return csrf
        # Try hidden input field
        soup = BeautifulSoup(resp.text, "html.parser")
        token_input = soup.find("input", {"name": "_token"}) or soup.find("input", {"name": "csrf_token"})
        if token_input:
            return token_input.get("value", "")
        return ""

    def login(self, email: str, password: str) -> InternshalaSession:
        self.csrf_token = self._get_csrf_token()

        payload = {"email": email, "password": password}
        if self.csrf_token:
            payload["_token"] = self.csrf_token

        self.session.headers.update({
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": f"{INTERNSHALA_BASE}/login",
        })

        response = self.session.post(
            f"{INTERNSHALA_BASE}/login/submit_login",
            data=payload
        )

        # Verify login succeeded
        if "logout" not in response.text.lower() and response.status_code != 200:
            raise RuntimeError(f"Login may have failed. Status: {response.status_code}")

        session_id = (
            self.session.cookies.get("PHPSESSID") or
            self.session.cookies.get("internshala_session") or
            ""
        )

        return InternshalaSession(csrf_token=self.csrf_token, session_id=session_id)

    def is_logged_in(self) -> bool:
        resp = self.session.get(f"{INTERNSHALA_BASE}/dashboard")
        return "login" not in resp.url and resp.status_code == 200
```

---

### Step 3 — `backend/portals/internshala/jobs.py`

```python
from typing import List
from portals.naukri.jobs import Job

INTERNSHALA_BASE = "https://internshala.com"

class InternshalaJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def search_internships(self, keyword: str = "", location: str = "") -> List[Job]:
        url = f"{INTERNSHALA_BASE}/internships/ajax"
        params = {}
        if keyword:
            params["search_po"] = keyword
        if location:
            params["location_po"] = location

        response = self.session.get(url, params=params)
        response.raise_for_status()
        return self._parse(response.json(), job_type="internship")

    def search_jobs(self, keyword: str = "", location: str = "") -> List[Job]:
        url = f"{INTERNSHALA_BASE}/jobs/ajax"
        params = {}
        if keyword:
            params["search_po"] = keyword
        if location:
            params["location_po"] = location

        response = self.session.get(url, params=params)
        response.raise_for_status()
        return self._parse(response.json(), job_type="job")

    def _parse(self, data: dict, job_type: str) -> List[Job]:
        jobs = []
        # Internshala returns a dict of items, not a list
        items_raw = (
            data.get("internships_meta") or
            data.get("jobs_meta") or
            data.get("internships") or
            data.get("jobs") or
            {}
        )

        # Handle both dict (keyed by ID) and list formats
        items = items_raw.values() if isinstance(items_raw, dict) else items_raw

        for item in items:
            stipend_data = item.get("stipend", {})
            salary = (
                stipend_data.get("salary") if isinstance(stipend_data, dict)
                else str(stipend_data)
            ) or "Unpaid"

            location_names = item.get("location_names", [])
            location = location_names[0] if location_names else item.get("work_from_home", False) and "Remote" or ""

            skills = item.get("skills", [])
            if isinstance(skills, str):
                skills = [s.strip() for s in skills.split(",") if s.strip()]

            jobs.append(Job(
                job_id=str(item.get("id", "")),
                title=item.get("profile_name", "") or item.get("title", ""),
                company=item.get("company_name", ""),
                location=location,
                experience="Fresher" if job_type == "internship" else item.get("experience", ""),
                salary=salary,
                posted_date=item.get("start_date", "") or item.get("posted_on", ""),
                apply_link=f"https://internshala.com{item.get('application_url', '')}",
                description=item.get("other_details", "") or item.get("job_description", ""),
                portal="internshala",
                tags=skills,
            ))
        return jobs
```

---

### Step 4 — `backend/portals/internshala/apply.py` (Playwright)

```python
from playwright.async_api import async_playwright
import asyncio
import random

PROFILE_DIR = "./chrome_profiles/internshala"

async def internshala_apply(
    job_url: str,
    cover_letter: str,
    availability: str = "Immediately",
    profile_dir: str = PROFILE_DIR
) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False
        )
        page = await browser.new_page()

        try:
            await page.goto(job_url)
            await page.wait_for_timeout(2000)

            # Check if already applied
            already_applied = await page.query_selector("button:has-text('Applied'), .applied-badge")
            if already_applied:
                await browser.close()
                return {"success": False, "reason": "Already applied to this listing"}

            # Find and click Apply button
            apply_btn = await page.query_selector(
                "button#apply_button, a.apply_now, button:has-text('Apply Now'), "
                "button:has-text('Apply')"
            )
            if not apply_btn:
                await browser.close()
                return {"success": False, "reason": "No apply button found"}

            await apply_btn.click()
            await page.wait_for_timeout(2000)

            # Cover letter field
            cover_field = await page.query_selector(
                "textarea#cover_letter, textarea[name='cover_letter'], "
                "textarea[placeholder*='cover'], textarea[placeholder*='Cover']"
            )
            if cover_field:
                await cover_field.fill(cover_letter)
                await page.wait_for_timeout(500)

            # Availability field (sometimes present)
            avail_field = await page.query_selector(
                "input[name='availability'], input[placeholder*='availability']"
            )
            if avail_field:
                await avail_field.fill(availability)

            # Submit the application
            submit_btn = await page.query_selector(
                "button#submit, button[type='submit'], button:has-text('Submit Application')"
            )
            if not submit_btn:
                await browser.close()
                return {"success": False, "reason": "No submit button found"}

            await submit_btn.click()
            await page.wait_for_timeout(3000)

            # Verify submission
            success_indicator = await page.query_selector(
                ".success-message, .thank-you, h1:has-text('Thank'), "
                "p:has-text('successfully applied')"
            )

            await browser.close()
            await asyncio.sleep(random.uniform(20, 60))

            if success_indicator:
                return {"success": True}
            else:
                return {"success": False, "reason": "Submit clicked but no success confirmation found"}

        except Exception as e:
            await browser.close()
            return {"success": False, "reason": str(e)}
```

---

### Step 5 — Browser Login Setup (one-time)

Before running Playwright apply, the user must log in manually once using the persistent Chrome profile:

```python
# backend/portals/internshala/setup_browser_session.py
# Run this script once to set up the browser session
import asyncio
from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/internshala"

async def setup():
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False
        )
        page = await browser.new_page()
        await page.goto("https://internshala.com/login")
        print("Please log in manually in the browser window.")
        print("Press Enter here once you are logged in and can see your dashboard...")
        input()
        await browser.close()
        print("Session saved to:", PROFILE_DIR)

asyncio.run(setup())
```

---

### Step 6 — Test Script

```python
# backend/test_internshala.py
import asyncio
from portals.internshala.auth import InternshalaAuthClient
from portals.internshala.jobs import InternshalaJobClient
from portals.internshala.apply import internshala_apply
from dotenv import load_dotenv
import os

load_dotenv()

async def main():
    print("=== Internshala Portal Test ===")

    auth = InternshalaAuthClient()
    session = auth.login(os.getenv("INTERNSHALA_EMAIL"), os.getenv("INTERNSHALA_PASSWORD"))
    print(f"[PASS] Login — session_id: {session.session_id[:15] if session.session_id else 'cookie-based'}")

    assert auth.is_logged_in(), "is_logged_in() returned False after successful login"
    print("[PASS] is_logged_in() check")

    jc = InternshalaJobClient(auth)

    internships = jc.search_internships(keyword="web development", location="Delhi")
    assert len(internships) > 0, "No internships returned"
    print(f"[PASS] Internship search — {len(internships)} returned")
    for i in internships[:2]:
        print(f"       {i.title} @ {i.company} | {i.salary} | {i.location}")
        assert i.job_id, "Missing job_id"
        assert i.apply_link.startswith("https://internshala.com"), "Bad apply link"

    jobs = jc.search_jobs(keyword="Python", location="Bangalore")
    print(f"[PASS] Job search — {len(jobs)} returned")

    # Apply test — uncomment only when ready for real test
    # if internships:
    #     result = await internshala_apply(
    #         job_url=internships[0].apply_link,
    #         cover_letter="I am excited about this opportunity..."
    #     )
    #     print(f"[APPLY TEST] {result}")

    print("\n=== All tests PASSED ===")

asyncio.run(main())
```

---

## Expected Success Behaviour

- Login completes, `is_logged_in()` returns `True`
- Internship search returns at least 5 results with valid `apply_link` URLs starting with `https://internshala.com`
- Each job has non-empty `title`, `company`, and `job_id`
- Playwright apply navigates to the listing, fills cover letter, submits, and returns `{"success": True}`
- A success message or "thank you" element is visible on the page after submit

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `RuntimeError: Login may have failed` | CSRF token required but not sent | Print the login response HTML; find the hidden CSRF field name; update payload key |
| `is_logged_in()` returns `False` after login | Login response didn't set session cookie | Check cookies with `auth.session.cookies.get_dict()`; try logging in via Playwright browser instead |
| `[]` from search | Wrong param names | Open DevTools and check actual param names used by the browser; update `params` dict |
| `No apply button found` | Internshala restructured their page | Open the URL manually; inspect the apply button's actual selector; update query |
| `No submit button found` | Form has extra steps (e.g. availability questions) | Add handling for intermediate form fields before submit |
| Playwright apply submits but returns no success indicator | Success message selector is wrong | Inspect the post-submit page; find the actual confirmation element; update selector |

## Challenges

- **CSRF handling**: Internshala uses CSRF tokens on their login form. The token may be in a hidden form field (`_token`), in a cookie, or both. Extract from the login page before POST. If CSRF changes per session, you must fetch it fresh before every login.
- **API vs Playwright boundary**: Use the `requests` session for search (fast, no browser needed) and only launch Playwright for the apply step. Mixing both for the same user means you have two separate sessions — the Playwright browser session does NOT share cookies with the `requests` session automatically.
- **Browser session setup**: The Playwright apply only works if the persistent Chrome profile is already logged in. Ship `setup_browser_session.py` as a CLI tool the user runs once during onboarding. The browser session typically lasts weeks without needing re-login.
- **Cover letter requirement**: Internshala almost always requires a cover letter. The AI layer (`qa_answerer.py`) can generate one based on the job description — wire this up before calling `internshala_apply()`.
- **Stipend formats**: Stipend data is inconsistent — sometimes a string (`"5,000 - 8,000/month"`), sometimes a nested dict, sometimes `null`. The parser handles multiple formats above but verify against your actual DevTools capture.
