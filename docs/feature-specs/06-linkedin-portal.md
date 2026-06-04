# Feature Spec 06 — LinkedIn Portal

## What This Is

LinkedIn Easy Apply automation using Playwright with a persistent Chrome profile. LinkedIn has the most aggressive bot detection of all portals — no internal API approach works reliably. The only safe method is a persistent browser session where the user has already logged in manually, combined with human-like delays and strict daily limits. Intercepts LinkedIn's internal Voyager API responses during normal browser navigation to extract job data as structured JSON.

## Prerequisites

- `02-core-backend-setup.md` complete (Playwright installed)
- `03-naukri-portal.md` complete (reuses `Job` dataclass)
- A real LinkedIn account with Easy Apply enabled
- `chrome_profiles/linkedin/` directory created
- User must complete one-time manual login setup (Step 1)

## Important Limits

- **Daily apply limit: 30 applications** (LinkedIn's practical safe threshold)
- **Delay between applies: 45–120 seconds** (random)
- **Apply only 9am–8pm IST** (enforced by SafeApplyManager)
- **Only jobs with "Easy Apply" button** — external apply jobs are skipped

---

## Implementation Steps

### Step 1 — One-Time Browser Session Setup

The user runs this script once during onboarding to log in and save the session:

```python
# backend/portals/linkedin/setup_session.py
import asyncio
from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/linkedin"

async def setup():
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = await browser.new_page()
        await page.goto("https://www.linkedin.com/login")
        print("Please log in to LinkedIn in the browser window that just opened.")
        print("Complete any 2FA if prompted.")
        print("Once you can see your LinkedIn feed, press Enter here...")
        input()
        # Verify session
        await page.goto("https://www.linkedin.com/feed")
        await page.wait_for_timeout(2000)
        if "feed" in page.url:
            print("[OK] Session saved successfully to:", PROFILE_DIR)
        else:
            print("[WARN] May not be fully logged in. URL:", page.url)
        await browser.close()

asyncio.run(setup())
```

---

### Step 2 — `backend/portals/linkedin/jobs.py`

Intercepts LinkedIn's internal Voyager API during normal page navigation:

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from typing import List
import asyncio
import json

PROFILE_DIR = "./chrome_profiles/linkedin"

EXPERIENCE_MAP = {
    "internship": "1",
    "entry":      "2",
    "associate":  "3",
    "mid-senior": "4",
    "director":   "5",
    "executive":  "6",
}

async def search_linkedin_jobs(
    keyword: str,
    location: str = "India",
    experience_level: str = "entry",  # internship, entry, associate, mid-senior
    max_jobs: int = 50
) -> List[Job]:
    exp_code = EXPERIENCE_MAP.get(experience_level, "2")
    captured_jobs: List[Job] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = await browser.new_page()

        async def on_response(response):
            if "voyager/api/jobs/jobPostings" in response.url and response.status == 200:
                try:
                    data = await response.json()
                    _extract_jobs_from_voyager(data, captured_jobs)
                except Exception:
                    pass

        page.on("response", on_response)

        # Verify we're logged in
        await page.goto("https://www.linkedin.com/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        if "login" in page.url:
            await browser.close()
            raise RuntimeError("LinkedIn session expired — user must run setup_session.py again")

        # Navigate to job search with Easy Apply filter
        search_url = (
            f"https://www.linkedin.com/jobs/search/"
            f"?keywords={keyword.replace(' ', '%20')}"
            f"&location={location.replace(' ', '%20')}"
            f"&f_E={exp_code}"
            f"&f_LF=f_AL"          # Easy Apply only
            f"&sortBy=DD"          # Date posted (most recent first)
        )
        await page.goto(search_url, wait_until="networkidle")
        await asyncio.sleep(4)

        # Scroll to load more results
        for _ in range(3):
            await page.keyboard.press("End")
            await asyncio.sleep(2)
            if len(captured_jobs) >= max_jobs:
                break

        await browser.close()

    return captured_jobs[:max_jobs]


def _extract_jobs_from_voyager(data: dict, jobs: List[Job]):
    elements = data.get("elements", [])
    for el in elements:
        card = (
            el.get("jobCardUnion", {}).get("jobPostingCard", {}) or
            el.get("entityResult", {}) or
            {}
        )
        if not card:
            continue

        entity_urn = card.get("entityUrn", "")
        job_id = entity_urn.split(":")[-1] if ":" in entity_urn else entity_urn

        title = card.get("jobPostingTitle", "") or card.get("title", {}).get("text", "")
        company = (
            card.get("primaryDescription", {}).get("text", "") or
            card.get("secondaryDescription", {}).get("text", "")
        )
        location = card.get("secondaryDescription", {}).get("text", "")
        listed_at = card.get("listedAt", 0)
        apply_link = f"https://www.linkedin.com/jobs/view/{job_id}"

        if job_id and title:
            jobs.append(Job(
                job_id=job_id,
                title=title,
                company=company,
                location=location,
                experience="",
                salary="",
                posted_date=str(listed_at),
                apply_link=apply_link,
                description="",  # fetched separately when needed
                portal="linkedin",
            ))
```

---

### Step 3 — `backend/portals/linkedin/apply.py`

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from ai.qa_answerer import answer_question
import asyncio
import random
import logging

PROFILE_DIR = "./chrome_profiles/linkedin"
logger = logging.getLogger(__name__)

async def linkedin_easy_apply(job: Job, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

            # Check if Easy Apply button exists
            easy_apply_btn = await page.query_selector(
                "button:has-text('Easy Apply'), .jobs-apply-button:has-text('Easy Apply')"
            )
            if not easy_apply_btn:
                await browser.close()
                return {"success": False, "reason": "No Easy Apply button — external apply job"}

            await easy_apply_btn.click()
            await page.wait_for_timeout(2000)

            # Walk through up to 10 form steps
            for step in range(10):
                await page.wait_for_timeout(1500)

                # Check if modal is still open
                modal = await page.query_selector(".jobs-easy-apply-modal, [data-test-modal]")
                if not modal:
                    break

                # Fill text/number inputs that are empty
                inputs = await page.query_selector_all(
                    ".jobs-easy-apply-modal input[type='text']:not([readonly]), "
                    ".jobs-easy-apply-modal input[type='tel']:not([readonly]), "
                    ".jobs-easy-apply-modal textarea"
                )
                for inp in inputs:
                    val = await inp.input_value()
                    if val:
                        continue
                    label = (
                        await inp.get_attribute("aria-label") or
                        await inp.get_attribute("placeholder") or
                        ""
                    )
                    if label:
                        answer = await answer_question(label, user_profile)
                        if answer:
                            await inp.fill(answer)
                            await page.wait_for_timeout(300)

                # Handle radio buttons / checkboxes
                radios = await page.query_selector_all(
                    ".jobs-easy-apply-modal input[type='radio']:not(:checked), "
                    ".jobs-easy-apply-modal input[type='checkbox']"
                )
                for radio in radios:
                    label = await radio.get_attribute("aria-label") or ""
                    answer = await answer_question(label, user_profile) if label else "Yes"
                    if answer.lower() in ("yes", "true", "1"):
                        await radio.click()
                        await page.wait_for_timeout(200)

                # Handle dropdowns
                selects = await page.query_selector_all(".jobs-easy-apply-modal select")
                for sel in selects:
                    val = await sel.input_value()
                    if not val:
                        try:
                            await sel.select_option(index=1)
                        except Exception:
                            pass

                # Navigate the form
                submit_btn = await page.query_selector("button:has-text('Submit application')")
                next_btn = await page.query_selector("button:has-text('Next')")
                review_btn = await page.query_selector("button:has-text('Review')")

                if submit_btn:
                    await submit_btn.click()
                    await page.wait_for_timeout(3000)
                    await browser.close()
                    await asyncio.sleep(random.uniform(45, 120))
                    return {"success": True}
                elif next_btn:
                    await next_btn.click()
                elif review_btn:
                    await review_btn.click()
                else:
                    logger.warning(f"No navigation button found at step {step + 1}")
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete Easy Apply form"}

        except Exception as e:
            await browser.close()
            logger.error(f"LinkedIn Easy Apply error: {e}")
            return {"success": False, "reason": str(e)}
```

---

### Step 4 — Session Check Utility

```python
# backend/portals/linkedin/auth.py

from playwright.async_api import async_playwright
import asyncio

PROFILE_DIR = "./chrome_profiles/linkedin"

async def is_session_active() -> bool:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=True
        )
        page = await browser.new_page()
        await page.goto("https://www.linkedin.com/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        logged_in = "feed" in page.url and "login" not in page.url
        await browser.close()
        return logged_in
```

---

### Step 5 — Test Script

```python
# backend/test_linkedin.py
import asyncio
from portals.linkedin.auth import is_session_active
from portals.linkedin.jobs import search_linkedin_jobs
from dotenv import load_dotenv

load_dotenv()

async def main():
    print("=== LinkedIn Portal Test ===")

    # 1. Session check
    active = await is_session_active()
    assert active, "Session not active — run setup_session.py first"
    print("[PASS] Session active")

    # 2. Job search
    jobs = await search_linkedin_jobs(
        keyword="React developer",
        location="Bangalore",
        experience_level="entry",
        max_jobs=20
    )
    assert len(jobs) > 0, "No jobs returned from LinkedIn"
    print(f"[PASS] Search — {len(jobs)} jobs intercepted")

    for j in jobs[:3]:
        assert j.job_id, "Missing job_id"
        assert j.apply_link.startswith("https://www.linkedin.com/jobs/view/"), "Bad apply link"
        print(f"       [{j.job_id}] {j.title} @ {j.company} | {j.location}")

    # 3. Easy Apply test — uncomment ONLY on a test/throwaway listing
    # from portals.linkedin.apply import linkedin_easy_apply
    # result = await linkedin_easy_apply(jobs[0], user_profile={...})
    # print(f"[APPLY TEST] {result}")

    print("\n=== All tests PASSED ===")

asyncio.run(main())
```

---

## Expected Success Behaviour

- `is_session_active()` returns `True` after manual login setup
- Job search returns at least 10 jobs (LinkedIn returns 25 per page by default)
- Every job has a non-empty `job_id` and a valid `apply_link`
- Easy Apply navigates through all form steps and returns `{"success": True}`
- After apply, a 45–120 second random delay passes before the next one

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `RuntimeError: LinkedIn session expired` | Cookie expired or cleared | User must run `setup_session.py` again |
| `No Easy Apply button` | Job uses external apply | Skip this job — filter for Easy Apply only at search time |
| `0 jobs returned` | Voyager API response format changed | Log the intercepted response URL and body; update `_extract_jobs_from_voyager` |
| `Could not complete Easy Apply form` | New form step type (e.g. file upload, date picker) | Add specific handler for that step type in the loop |
| CAPTCHA appears during search | Too many searches too fast | Add 10+ second delays between searches; reduce search frequency |
| 2FA popup after session restore | LinkedIn security check | User must re-login via `setup_session.py` and approve 2FA |

## Challenges

- **LinkedIn's anti-bot detection is the most aggressive**: Any deviation from human-like behaviour triggers CAPTCHA or account restriction. Key rules: never run headless for apply, use random delays, do not exceed 30 applies per day, and always use a real logged-in profile.
- **Voyager API changes frequently**: LinkedIn updates their internal API schema multiple times per year. The `_extract_jobs_from_voyager` parser must be resilient — always use `.get()` with fallbacks and log the raw response when 0 jobs are returned.
- **Easy Apply form variability**: Every job's Easy Apply form is different. Some have 1 step, some have 7. Some ask work authorization questions, some ask availability. The form walker above handles the common cases — add specific handlers as you encounter new field types.
- **No salary data**: LinkedIn's Voyager API rarely includes salary in the job card response. The `salary` field will be empty for most LinkedIn jobs.
- **Profile picture and file uploads**: Some Easy Apply forms ask for a profile photo or portfolio file. These cannot be auto-filled — detect `input[type='file']` and skip or handle separately.
- **Rate limit vs quality**: 30 applies/day is the safe ceiling. Focus on high-score jobs (AI score ≥ 75) for LinkedIn given its importance, rather than bulk-applying to all 60+ matches.
