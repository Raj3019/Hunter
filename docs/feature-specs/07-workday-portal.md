# Feature Spec 07 — Workday Portal

## What This Is

A single generic Playwright handler that covers 100+ companies running on Workday's ATS (Wipro, IBM India, Capgemini, Deloitte, PwC, EY, Adobe India, Cisco India, Dell, HP, and more). Build it once — applies to all of them. Intercepts Workday's internal API responses during browser navigation for clean job data, then uses Playwright to walk through the standardised multi-step application form.

## Prerequisites

- `02-core-backend-setup.md` complete (Playwright installed)
- `03-naukri-portal.md` complete (reuses `Job` dataclass)
- `10-ai-layer.md` spec reviewed (uses `qa_answerer` for form filling)
- `portals/workday/` directory inside `backend/`
- `chrome_profiles/workday/` directory for persistent session

## No Daily Limit Hardcoded by Workday

Workday company sites don't have platform-level apply limits. Use a conservative internal limit of 50/day split across companies, with 60–150 second delays between applies.

---

## Implementation Steps

### Step 1 — `backend/portals/workday/companies.py`

Central registry of supported companies. Add more as needed:

```python
WORKDAY_COMPANIES = {
    "wipro": {
        "name": "Wipro",
        "careers_url": "https://careers.wipro.com/careers-home/jobs",
        "apply_base": "https://wipro.wd3.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "ibm": {
        "name": "IBM India",
        "careers_url": "https://www.ibm.com/employment",
        "apply_base": "https://ibm.wd12.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "capgemini": {
        "name": "Capgemini",
        "careers_url": "https://www.capgemini.com/in-en/careers/job-search/",
        "apply_base": "https://capgemini.wd3.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "deloitte": {
        "name": "Deloitte India",
        "careers_url": "https://apply.deloitte.com/careers/SearchJobs",
        "apply_base": "https://deloitte.wd1.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "pwc": {
        "name": "PwC India",
        "careers_url": "https://www.pwc.in/careers/experienced-careers/search-apply-for-jobs.html",
        "apply_base": "https://pwc.wd3.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "ey": {
        "name": "EY India",
        "careers_url": "https://careers.ey.com/ey/jobs",
        "apply_base": "https://ey.wd5.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "adobe": {
        "name": "Adobe India",
        "careers_url": "https://adobe.wd5.myworkdayjobs.com/en-US/external_experienced",
        "apply_base": "https://adobe.wd5.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "cisco": {
        "name": "Cisco India",
        "careers_url": "https://jobs.cisco.com/jobs/SearchJobs",
        "apply_base": "https://cisco.wd5.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "dell": {
        "name": "Dell India",
        "careers_url": "https://dell.wd1.myworkdayjobs.com/ExternalNonPublic",
        "apply_base": "https://dell.wd1.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
    "kpmg": {
        "name": "KPMG India",
        "careers_url": "https://kpmg.wd3.myworkdayjobs.com/india",
        "apply_base": "https://kpmg.wd3.myworkdayjobs.com",
        "search_keyword_param": "q",
    },
}
```

---

### Step 2 — `backend/portals/workday/jobs.py`

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from typing import List
import asyncio

PROFILE_DIR = "./chrome_profiles/workday"

async def search_workday_jobs(
    company_key: str,
    keyword: str,
    location: str = "India",
    max_jobs: int = 30
) -> List[Job]:
    from .companies import WORKDAY_COMPANIES
    company = WORKDAY_COMPANIES.get(company_key)
    if not company:
        return []

    captured: List[dict] = []
    jobs: List[Job] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=True  # headless OK for search (no login required)
        )
        page = await browser.new_page()

        async def on_response(response):
            if "myworkdayjobs.com" in response.url and "/jobs" in response.url and response.status == 200:
                try:
                    data = await response.json()
                    captured.append(data)
                except Exception:
                    pass

        page.on("response", on_response)

        await page.goto(company["careers_url"], wait_until="networkidle")
        await asyncio.sleep(2)

        # Try to fill keyword search
        search_selectors = [
            f"input[placeholder*='Search'], input[name='{company.get(\"search_keyword_param\", \"q\")}']",
            "input[type='search']",
            "input[aria-label*='Search']",
            "input[placeholder*='Job title']",
        ]
        for selector in search_selectors:
            try:
                search_box = await page.query_selector(selector)
                if search_box:
                    await search_box.fill(keyword)
                    await search_box.press("Enter")
                    await asyncio.sleep(3)
                    break
            except Exception:
                continue

        # Parse intercepted API responses
        for data in captured:
            postings = (
                data.get("jobPostings") or
                data.get("jobs") or
                []
            )
            for posting in postings:
                title = posting.get("title", "")
                if not title:
                    continue
                ext_path = posting.get("externalPath", "")
                apply_link = f"{company['apply_base']}{ext_path}" if ext_path else ""
                bullet_fields = posting.get("bulletFields", [])
                job_id = bullet_fields[0] if bullet_fields else posting.get("id", "")

                jobs.append(Job(
                    job_id=str(job_id),
                    title=title,
                    company=company["name"],
                    location=posting.get("locationsText", location),
                    experience="",
                    salary="",
                    posted_date=posting.get("postedOn", ""),
                    apply_link=apply_link,
                    description=posting.get("jobDescription", ""),
                    portal="workday",
                    is_workday=True,
                ))
                if len(jobs) >= max_jobs:
                    break

        await browser.close()

    return jobs
```

---

### Step 3 — `backend/portals/workday/apply.py`

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from ai.qa_answerer import answer_question
import asyncio
import random
import logging

PROFILE_DIR = "./chrome_profiles/workday"
logger = logging.getLogger(__name__)

async def workday_apply(job: Job, resume_path: str, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

            # Find and click the Apply button
            apply_selectors = [
                "a:has-text('Apply')",
                "button:has-text('Apply')",
                "button[data-automation-id='applyButton']",
                "a[data-automation-id='applyButton']",
            ]
            clicked = False
            for selector in apply_selectors:
                try:
                    await page.click(selector, timeout=4000)
                    clicked = True
                    break
                except Exception:
                    continue

            if not clicked:
                await browser.close()
                return {"success": False, "reason": "No Apply button found on job page"}

            await page.wait_for_timeout(2500)

            # Walk through up to 15 form steps
            for step in range(15):
                await page.wait_for_timeout(2000)

                # Resume upload
                file_input = await page.query_selector("input[type='file']")
                if file_input:
                    await file_input.set_input_files(resume_path)
                    await page.wait_for_timeout(1500)

                # Fill text fields
                text_inputs = await page.query_selector_all(
                    "input[type='text']:not([readonly]):not([disabled]), "
                    "input[type='tel']:not([readonly]):not([disabled]), "
                    "textarea:not([readonly]):not([disabled])"
                )
                for inp in text_inputs:
                    val = await inp.input_value()
                    if val:
                        continue
                    label = (
                        await inp.get_attribute("aria-label") or
                        await inp.get_attribute("placeholder") or
                        await inp.get_attribute("data-automation-id") or
                        ""
                    )
                    if label:
                        answer = await answer_question(label, user_profile)
                        if answer:
                            await inp.fill(answer)
                            await page.wait_for_timeout(400)

                # Fill dropdowns
                selects = await page.query_selector_all("select:not([disabled])")
                for sel in selects:
                    val = await sel.input_value()
                    if not val:
                        try:
                            options = await sel.query_selector_all("option")
                            if len(options) > 1:
                                await sel.select_option(index=1)
                        except Exception:
                            pass

                # Workday custom dropdowns (not native <select>)
                wd_dropdowns = await page.query_selector_all(
                    "[data-automation-id='promptOption']:not([aria-selected='true'])"
                )
                for dd in wd_dropdowns[:3]:  # limit to avoid clicking everything
                    try:
                        await dd.click()
                        await page.wait_for_timeout(300)
                    except Exception:
                        pass

                # Check for navigation/submit
                submit_btn = await page.query_selector(
                    "button[data-automation-id='bottom-navigation-next-button']:has-text('Submit'), "
                    "button:has-text('Submit'), button:has-text('Apply')"
                )
                next_btn = await page.query_selector(
                    "button[data-automation-id='bottom-navigation-next-button'], "
                    "button:has-text('Next'), button:has-text('Save and Continue')"
                )

                if submit_btn:
                    await submit_btn.click()
                    await page.wait_for_timeout(3000)
                    await browser.close()
                    await asyncio.sleep(random.uniform(60, 150))
                    return {"success": True}
                elif next_btn:
                    await next_btn.click()
                else:
                    logger.warning(f"Workday: no navigation button at step {step + 1} for {job.title}")
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete Workday form"}

        except Exception as e:
            await browser.close()
            logger.error(f"Workday apply error for {job.title}: {e}")
            return {"success": False, "reason": str(e)}
```

---

### Step 4 — Test Script

```python
# backend/test_workday.py
import asyncio
from portals.workday.jobs import search_workday_jobs

async def main():
    print("=== Workday Portal Test ===")

    test_companies = ["wipro", "capgemini", "adobe"]

    for company_key in test_companies:
        jobs = await search_workday_jobs(
            company_key=company_key,
            keyword="software engineer",
            location="India",
            max_jobs=10
        )
        status = f"[PASS] {company_key}: {len(jobs)} jobs" if jobs else f"[WARN] {company_key}: 0 jobs — check URL or selector"
        print(status)
        for j in jobs[:2]:
            print(f"       {j.title} | link: {j.apply_link[:60]}...")

    # Apply test (manual — pick a job you don't mind applying to)
    # jobs = await search_workday_jobs("wipro", "Python developer")
    # if jobs:
    #     from portals.workday.apply import workday_apply
    #     result = await workday_apply(jobs[0], "./test_resume.pdf", user_profile={...})
    #     print(f"[APPLY TEST] {result}")

    print("\n=== Test complete ===")

asyncio.run(main())
```

---

## Expected Success Behaviour

- `search_workday_jobs("wipro", "software engineer")` returns at least 5 jobs with valid `apply_link` URLs pointing to `wipro.wd3.myworkdayjobs.com`
- Test passes for at least 3 different company keys
- `workday_apply()` navigates through all form steps, uploads the resume, fills text fields, and returns `{"success": True}`
- After apply, a 60–150 second delay passes before the function returns

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `0 jobs` for a company | Careers URL changed or search param different | Open the careers URL manually; check actual API calls in DevTools; update `companies.py` |
| `No Apply button` | Workday requires account login before applying | Set up persistent Chrome profile with Workday account login; see Step 1 equivalent from Internshala spec |
| Form gets stuck at step N | New required field type not handled | Inspect what field type is blocking; add specific handler |
| Resume upload fails | File input selector wrong for this company's Workday instance | Check `input[type='file']` selector in DevTools for that specific company's Workday |
| Custom dropdown doesn't respond | Workday's custom dropdown uses different `data-automation-id` | Inspect the element; update the selector for `wd_dropdowns` |

## Challenges

- **Workday has variants**: While the form structure is standardised, different companies customise their Workday instances with extra questions, required fields, and different navigation button labels. Test on at least 3 different companies before declaring the handler "generic."
- **Account requirement**: Some Workday instances require you to create an account on their Workday portal before you can apply. Handle this the same way as company portals (spec 09) — user creates account once, credentials saved encrypted.
- **API interception is fragile**: The Voyager-style interception for job search depends on Workday calling a predictable URL pattern (`myworkdayjobs.com/jobs`). If a company's Workday instance uses a different URL pattern, 0 jobs will be returned. Fall back to parsing the page DOM for job listings.
- **Resume file format**: Upload the tailored `.docx` if available, otherwise the original PDF. Most Workday forms accept both.
- **Long form steps**: Some Workday applications have 8–10 steps including work history, education history, and custom questionnaires. Set `max_steps=15` as a safety ceiling.
