# Feature Spec 08 — Taleo Portal (HCL Focus)

## What This Is

A Playwright handler for companies running Oracle Taleo as their ATS. In practice, **HCL Technologies is the primary target** — one of India's largest employers with thousands of open roles. Taleo is deprioritised to Week 9 because it is technically harder than Greenhouse or Darwinbox with lower-quality job outcomes. Build it after the higher-value portals are stable.

Taleo's defining technical challenge: **the entire application runs inside an iframe**. Standard `page.query_selector()` finds nothing — you must switch to the frame context. The frame reference also goes stale after every page navigation and must be re-fetched at each step.

## Prerequisites

- `02-core-backend-setup.md` complete (Playwright installed)
- `03-naukri-portal.md` complete (reuses `Job` dataclass)
- `10-ai-layer.md` complete (uses `qa_answerer`)
- `portals/taleo/` directory inside `backend/`
- `chrome_profiles/taleo/` directory
- HCL account created manually at `hcl.taleo.net` (required before applying)

## Why Deprioritised

| Factor | Reality |
|---|---|
| Companies | Mainly IT services — HCL, Oracle India, Tech Mahindra, Mphasis |
| Pay range | Mid-level IT services salaries |
| Technical difficulty | High — iframes, stale contexts, account required |
| Build time | 3–4 days vs 1 day for Greenhouse |
| Value vs effort | Lower than Greenhouse or Darwinbox |

**Build Greenhouse and Darwinbox first.** Add Taleo only if you specifically need HCL jobs.

---

## Implementation Steps

### Step 1 — `backend/portals/taleo/companies.py`

Trimmed to high-value Indian targets only:

```python
TALEO_COMPANIES = {
    "hcl": {
        "name": "HCL Technologies",
        "search_url": "https://hcl.taleo.net/careersection/hcl_professional/jobsearch.ftl",
        "taleo_base": "https://hcl.taleo.net",
        "login_url": "https://hcl.taleo.net/careersection/hcl_professional/jobsearch.ftl",
        "search_keyword_param": "keyword",
    },
    "tech_mahindra": {
        "name": "Tech Mahindra",
        "search_url": "https://techmahindra.taleo.net/careersection/external/jobsearch.ftl",
        "taleo_base": "https://techmahindra.taleo.net",
        "login_url": "https://techmahindra.taleo.net/careersection/external/jobsearch.ftl",
        "search_keyword_param": "keyword",
    },
    "mphasis": {
        "name": "Mphasis",
        "search_url": "https://mphasis.taleo.net/careersection/mphasis_external_career_site/jobsearch.ftl",
        "taleo_base": "https://mphasis.taleo.net",
        "login_url": "https://mphasis.taleo.net/careersection/mphasis_external_career_site/jobsearch.ftl",
        "search_keyword_param": "keyword",
    },
}
```

---

### Step 2 — `backend/portals/taleo/jobs.py`

Taleo has no JSON API — search results are an HTML table rendered inside an iframe:

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from typing import List
import asyncio
import logging

logger = logging.getLogger(__name__)

async def search_taleo_jobs(
    company_key: str,
    keyword: str,
    location: str = "",
    max_jobs: int = 20
) -> List[Job]:
    from .companies import TALEO_COMPANIES
    company = TALEO_COMPANIES.get(company_key)
    if not company:
        logger.warning(f"Unknown Taleo company: {company_key}")
        return []

    jobs: List[Job] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(20000)

        try:
            await page.goto(company["search_url"], wait_until="networkidle")
            await asyncio.sleep(2)

            # --- The iframe problem ---
            # Taleo renders everything in an iframe. Must find it first.
            frame = _find_taleo_frame(page)
            target = frame or page

            # Fill keyword search field
            kw_selectors = [
                f"input[name='{company.get('search_keyword_param', 'keyword')}']",
                "input#keyword",
                "input[title='Keywords']",
                "input[aria-label*='keyword' i]",
            ]
            filled = False
            for sel in kw_selectors:
                try:
                    inp = await target.query_selector(sel)
                    if inp:
                        await inp.fill(keyword)
                        filled = True
                        break
                except Exception:
                    continue

            if not filled:
                logger.warning(f"[Taleo/{company_key}] Could not find keyword input")

            # Submit search
            submit = await target.query_selector(
                "input[type='submit'], button[type='submit'], button:has-text('Search')"
            )
            if submit:
                await submit.click()
                await asyncio.sleep(3)

            # Re-fetch frame — page may have navigated
            frame = _find_taleo_frame(page)
            target = frame or page

            # Extract job rows — Taleo uses a results table
            job_rows = await target.query_selector_all(
                "tr.listRow, tr.even, tr.odd, .jobListItem, .job-result-row"
            )

            if not job_rows:
                logger.warning(f"[Taleo/{company_key}] No job rows found — selector may need updating")

            for row in job_rows[:max_jobs]:
                try:
                    title_el = await row.query_selector(".jobTitle a, td.jobTitle, .job-title a, a[href*='jobdetail']")
                    link_el = await row.query_selector("a[href*='/careersection'], a[href*='jobdetail']")
                    location_el = await row.query_selector(".jobLocation, td.location, td:nth-child(3)")

                    title = (await title_el.inner_text()).strip() if title_el else ""
                    link = await link_el.get_attribute("href") if link_el else ""
                    loc = (await location_el.inner_text()).strip() if location_el else location

                    if not title or not link:
                        continue

                    full_link = (
                        link if link.startswith("http")
                        else f"{company['taleo_base']}{link}"
                    )

                    job_id = (
                        link.split("jobId=")[-1].split("&")[0]
                        if "jobId=" in link
                        else str(len(jobs) + 1)
                    )

                    jobs.append(Job(
                        job_id=job_id,
                        title=title,
                        company=company["name"],
                        location=loc,
                        experience="",
                        salary="",
                        posted_date="",
                        apply_link=full_link,
                        description="",
                        portal="taleo",
                        is_taleo=True,
                    ))
                except Exception as e:
                    logger.debug(f"Error parsing Taleo row: {e}")
                    continue

        except Exception as e:
            logger.error(f"[Taleo/{company_key}] Search failed: {e}")
        finally:
            await browser.close()

    return jobs


def _find_taleo_frame(page):
    """
    Find the Taleo iframe context.
    IMPORTANT: Call this again after every page navigation —
    the old frame reference goes stale and raises errors.
    """
    for frame in page.frames:
        if "taleo" in frame.url and frame.url != page.url:
            return frame
    return None
```

---

### Step 3 — `backend/portals/taleo/apply.py`

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from portals.taleo.jobs import _find_taleo_frame
from ai.qa_answerer import answer_question
import asyncio
import random
import logging

PROFILE_DIR = "./chrome_profiles/taleo"
logger = logging.getLogger(__name__)

async def taleo_apply(job: Job, resume_path: str, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False  # visible — Taleo login and popups need to be seen
        )
        page = await browser.new_page()
        page.set_default_timeout(15000)

        try:
            await page.goto(job.apply_link, wait_until="networkidle")
            await page.wait_for_timeout(2000)

            # Find iframe context
            frame = _find_taleo_frame(page)
            target = frame or page

            # Click Apply / Apply Online
            apply_selectors = [
                "a:has-text('Apply Online')",
                "a:has-text('Apply Now')",
                "button:has-text('Apply')",
                "input[value='Apply']",
                "a[title*='Apply']",
            ]
            clicked = False
            for selector in apply_selectors:
                try:
                    await target.click(selector, timeout=4000)
                    clicked = True
                    await page.wait_for_timeout(2500)
                    break
                except Exception:
                    continue

            if not clicked:
                await browser.close()
                return {"success": False, "reason": "No Apply button found — may require account login"}

            # Walk through form steps
            for step in range(12):
                await page.wait_for_timeout(2000)

                # Re-fetch frame on every step — it goes stale after navigation
                frame = _find_taleo_frame(page)
                target = frame or page

                # Resume upload
                file_input = await page.query_selector("input[type='file']")
                if file_input:
                    await file_input.set_input_files(resume_path)
                    await page.wait_for_timeout(1500)

                # Fill text inputs
                inputs = await target.query_selector_all(
                    "input[type='text']:not([readonly]):not([disabled]), "
                    "input[type='email']:not([readonly]):not([disabled]), "
                    "input[type='tel']:not([readonly]):not([disabled]), "
                    "textarea:not([readonly]):not([disabled])"
                )
                for inp in inputs:
                    try:
                        val = await inp.input_value()
                        if val:
                            continue
                        label = (
                            await inp.get_attribute("aria-label") or
                            await inp.get_attribute("title") or
                            await inp.get_attribute("name") or ""
                        )
                        if label:
                            answer = await answer_question(label, user_profile)
                            if answer:
                                await inp.fill(answer)
                                await page.wait_for_timeout(300)
                    except Exception:
                        continue

                # Fill selects
                selects = await target.query_selector_all("select:not([disabled])")
                for sel in selects:
                    try:
                        val = await sel.input_value()
                        if not val:
                            options = await sel.query_selector_all("option")
                            if len(options) > 1:
                                await sel.select_option(index=1)
                    except Exception:
                        continue

                # Navigation
                submit = await target.query_selector(
                    "input[type='submit'][value*='Submit'], "
                    "input[type='submit'][value*='Finish'], "
                    "button:has-text('Submit'), button:has-text('Finish')"
                )
                next_btn = await target.query_selector(
                    "input[type='submit'][value='Next'], "
                    "button:has-text('Next'), a:has-text('Continue')"
                )

                if submit:
                    await submit.click()
                    await page.wait_for_timeout(3000)
                    await browser.close()
                    await asyncio.sleep(random.uniform(60, 150))
                    return {"success": True}
                elif next_btn:
                    await next_btn.click()
                else:
                    logger.warning(f"[Taleo] No navigation at step {step + 1}")
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete Taleo form"}

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            return {"success": False, "reason": str(e)}
```

---

### Step 4 — Test Script

```python
# backend/test_taleo.py
import asyncio
from portals.taleo.jobs import search_taleo_jobs

async def main():
    print("=== Taleo Portal Test (HCL focus) ===")

    jobs = await search_taleo_jobs(
        company_key="hcl",
        keyword="software engineer",
        max_jobs=10
    )

    if jobs:
        print(f"[PASS] HCL: {len(jobs)} jobs found")
        for j in jobs[:3]:
            print(f"       [{j.job_id}] {j.title} | {j.location}")
            assert j.is_taleo, "is_taleo flag not set"
            assert j.apply_link.startswith("https://hcl.taleo.net"), "Bad apply link"
        print("[PASS] All assertions passed")
    else:
        print("[WARN] 0 jobs — check search URL and iframe selectors in DevTools")
        print("       Open https://hcl.taleo.net/careersection/hcl_professional/jobsearch.ftl")
        print("       Inspect the job results table structure and update selectors")

asyncio.run(main())
```

---

## Expected Success Behaviour

- `search_taleo_jobs("hcl", "software engineer")` returns at least 5 jobs
- All jobs have `is_taleo=True` and links starting with `https://hcl.taleo.net`
- Apply walks through the iframe form and returns `{"success": True}`
- 60–150 second delay after each apply

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `0 jobs` returned | Iframe selector wrong or job row selector outdated | Open the search URL in browser, DevTools → inspect the iframe and job row HTML; update selectors |
| `No Apply button` | HCL requires account login before applying | Set up encrypted account credentials (spec 09 pattern) + login before applying |
| Frame stale after step N | Forgot to re-fetch frame after navigation | Always call `_find_taleo_frame(page)` at the START of each loop iteration |
| Form errors on submit | Required field left empty | Log what field has an error; add specific handler for that label |

## Challenges

- **Iframe is the core difficulty**: Every element interaction must go through `target = _find_taleo_frame(page) or page`. If you use `page.query_selector()` instead of `target.query_selector()`, you'll find nothing and wonder why.
- **Frame stale reference**: After clicking Next, Taleo reloads the iframe content. The old `frame` variable now points to a detached frame — any call on it raises `Frame was detached`. Re-fetch with `_find_taleo_frame(page)` every iteration.
- **HCL account required**: HCL Taleo requires a registered account at `hcl.taleo.net` before you can apply. Follow the company portal pattern from spec 09 — save encrypted credentials and use Playwright to log in automatically.
- **Selectors break without warning**: Taleo allows each company to customise their portal. HCL's row selectors may differ from Tech Mahindra's. Always verify selectors against the live page with DevTools before assuming they'll work.
