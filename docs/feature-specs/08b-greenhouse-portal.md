# Feature Spec 08b — Greenhouse Portal

## What This Is

Greenhouse is the ATS used by the best-paying Indian tech companies — Swiggy, CRED, Razorpay, Meesho, PhonePe, Zepto, Groww, BrowserStack, Postman, and dozens more. It is also the **easiest portal to build** because Greenhouse provides a completely free, public, no-authentication JSON API for job listings. No browser needed for search — pure `httpx` calls returning clean JSON. Apply is handled via Playwright on a standardised form that is nearly identical across all companies.

This is the **highest value-to-effort portal in the entire project**. Build it before Workday, Darwinbox, or Taleo.

## Why Greenhouse is Different

| | Naukri | LinkedIn | Taleo | **Greenhouse** |
|---|---|---|---|---|
| Search method | Reverse-engineered API + nkparam | Playwright interception | HTML scraping inside iframes | **Free public JSON API** |
| Auth for search | Bearer token required | Chrome profile required | None (but fragile) | **Nothing — fully open** |
| Stability | Medium (nkparam breaks) | Low (Voyager changes) | Low (selectors break) | **High — API is stable** |
| Apply form | One-click Easy Apply | Multi-step modal | Iframe-based form | **Standardised form, same across all companies** |
| Indian company quality | Volume jobs | Premium jobs | IT services | **Top-tier startups** |

## Prerequisites

- `02-core-backend-setup.md` complete
- `03-naukri-portal.md` complete (reuses `Job` dataclass)
- `10-ai-layer.md` complete (uses `qa_answerer`)
- `portals/greenhouse/` directory inside `backend/`
- `chrome_profiles/greenhouse/` directory

## No API Key Needed

The Greenhouse Jobs Board API is completely public. No registration, no token, no rate limit headers. It is designed to be publicly accessible so anyone can embed a company's job board. We use it as a search API.

---

## How the Greenhouse API Works

Every company on Greenhouse gets a subdomain slug. Examples:

```
Swiggy:       https://boards-api.greenhouse.io/v1/boards/swiggy/jobs
Razorpay:     https://boards-api.greenhouse.io/v1/boards/razorpay/jobs
CRED:         https://boards-api.greenhouse.io/v1/boards/cred/jobs
Meesho:       https://boards-api.greenhouse.io/v1/boards/meesho/jobs
PhonePe:      https://boards-api.greenhouse.io/v1/boards/phonepe/jobs
```

Response structure:
```json
{
  "jobs": [
    {
      "id": 4567890,
      "title": "Software Engineer - Backend",
      "updated_at": "2025-05-01T10:00:00.000Z",
      "location": { "name": "Bangalore, India" },
      "absolute_url": "https://boards.greenhouse.io/swiggy/jobs/4567890",
      "departments": [{ "name": "Engineering" }],
      "offices": [{ "name": "Bangalore" }],
      "metadata": []
    }
  ],
  "meta": { "total": 142 }
}
```

Job detail (includes full description):
```
GET https://boards-api.greenhouse.io/v1/boards/swiggy/jobs/4567890
```

---

## Implementation Steps

### Step 1 — `backend/portals/greenhouse/companies.py`

The company slug is found in the Greenhouse job board URL. To find a new company's slug:
1. Go to their careers page
2. Look for links containing `greenhouse.io` or `boards.greenhouse.io`
3. The path segment after `/boards/` is the slug

```python
GREENHOUSE_COMPANIES = {
    # Fintech / Payments
    "razorpay":     {"name": "Razorpay",     "slug": "razorpay"},
    "phonepe":      {"name": "PhonePe",      "slug": "phonepe"},
    "cred":         {"name": "CRED",         "slug": "cred"},
    "groww":        {"name": "Groww",        "slug": "groww"},
    "paytm":        {"name": "Paytm",        "slug": "paytm"},
    "moneyfwd":     {"name": "MoneyForward", "slug": "moneyforward"},

    # E-commerce / Quick Commerce
    "swiggy":       {"name": "Swiggy",       "slug": "swiggy"},
    "meesho":       {"name": "Meesho",       "slug": "meesho"},
    "zepto":        {"name": "Zepto",        "slug": "zepto"},
    "blinkit":      {"name": "Blinkit",      "slug": "blinkit"},

    # SaaS / Dev Tools
    "browserstack": {"name": "BrowserStack", "slug": "browserstack"},
    "postman":      {"name": "Postman",      "slug": "postman"},
    "hasura":       {"name": "Hasura",       "slug": "hasura"},
    "setu":         {"name": "Setu",         "slug": "setu"},
    "chargebee":    {"name": "Chargebee",    "slug": "chargebee"},
    "freshworks":   {"name": "Freshworks",   "slug": "freshworks"},

    # Other high-growth
    "urbancompany": {"name": "Urban Company","slug": "urbancompany"},
    "licious":      {"name": "Licious",      "slug": "licious"},
    "sharechat":    {"name": "ShareChat",    "slug": "sharechat"},
    "moj":          {"name": "Moj",          "slug": "moj"},
    "khatabook":    {"name": "Khatabook",    "slug": "khatabook"},
    "juspay":       {"name": "Juspay",       "slug": "juspay"},
    "salaryhub":    {"name": "Open Financial","slug": "openfinancial"},
}

GREENHOUSE_API_BASE = "https://boards-api.greenhouse.io/v1/boards"
GREENHOUSE_BOARD_BASE = "https://boards.greenhouse.io"
```

> **How to add a new company**: Go to their careers page → look for `greenhouse.io` in any job link → copy the slug between `/boards/` and `/jobs/`. Add one line to this dict.

---

### Step 2 — `backend/portals/greenhouse/jobs.py`

Pure `httpx` — no browser needed for search:

```python
import httpx
import logging
from typing import List, Optional
from portals.naukri.jobs import Job
from .companies import GREENHOUSE_COMPANIES, GREENHOUSE_API_BASE, GREENHOUSE_BOARD_BASE

logger = logging.getLogger(__name__)

async def search_greenhouse_jobs(
    keyword: str = "",
    companies: Optional[List[str]] = None,
    location_filter: str = "india",
    max_per_company: int = 20,
) -> List[Job]:
    """
    Search jobs across all (or specified) Greenhouse companies.
    No auth required. Returns clean structured Job objects.

    Args:
        keyword: filter by job title keyword (client-side filter)
        companies: list of company keys from GREENHOUSE_COMPANIES
                   if None, searches all companies
        location_filter: filter location string (case-insensitive)
        max_per_company: max jobs to return per company
    """
    targets = companies or list(GREENHOUSE_COMPANIES.keys())
    all_jobs: List[Job] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for company_key in targets:
            company = GREENHOUSE_COMPANIES.get(company_key)
            if not company:
                logger.warning(f"Unknown Greenhouse company key: {company_key}")
                continue

            try:
                jobs = await _fetch_company_jobs(
                    client, company_key, company,
                    keyword, location_filter, max_per_company
                )
                all_jobs.extend(jobs)
                logger.info(f"[Greenhouse/{company['name']}] {len(jobs)} jobs matched")
            except Exception as e:
                logger.error(f"[Greenhouse/{company['name']}] Fetch failed: {e}")
                continue

    return all_jobs


async def _fetch_company_jobs(
    client: httpx.AsyncClient,
    company_key: str,
    company: dict,
    keyword: str,
    location_filter: str,
    max_per_company: int,
) -> List[Job]:
    slug = company["slug"]
    url = f"{GREENHOUSE_API_BASE}/{slug}/jobs"

    response = await client.get(url, params={"content": "true"})

    if response.status_code == 404:
        logger.warning(f"[Greenhouse] Slug '{slug}' not found — company may have left Greenhouse")
        return []

    response.raise_for_status()
    data = response.json()
    raw_jobs = data.get("jobs", [])

    jobs: List[Job] = []
    for item in raw_jobs:
        title = item.get("title", "")
        location_name = item.get("location", {}).get("name", "")

        # Client-side keyword filter (Greenhouse API has no server-side keyword param)
        if keyword and keyword.lower() not in title.lower():
            continue

        # Client-side location filter
        if location_filter and location_filter.lower() not in location_name.lower():
            # Also check offices
            offices = [o.get("name", "") for o in item.get("offices", [])]
            if not any(location_filter.lower() in o.lower() for o in offices):
                continue

        job_id = str(item.get("id", ""))
        apply_link = item.get("absolute_url", f"{GREENHOUSE_BOARD_BASE}/{slug}/jobs/{job_id}")

        # Extract description from content (included when ?content=true)
        content = item.get("content", "")
        # Strip HTML tags for clean description
        import re
        description = re.sub(r"<[^>]+>", " ", content).strip() if content else ""

        departments = [d.get("name", "") for d in item.get("departments", [])]

        jobs.append(Job(
            job_id=job_id,
            title=title,
            company=company["name"],
            location=location_name,
            experience="",
            salary="",
            posted_date=item.get("updated_at", ""),
            apply_link=apply_link,
            description=description[:2000],  # cap for DB storage
            portal="greenhouse",
            tags=departments,
        ))

        if len(jobs) >= max_per_company:
            break

    return jobs


async def get_job_detail(company_key: str, job_id: str) -> dict:
    """Fetch full job description for a specific job."""
    company = GREENHOUSE_COMPANIES.get(company_key)
    if not company:
        return {}

    slug = company["slug"]
    url = f"{GREENHOUSE_API_BASE}/{slug}/jobs/{job_id}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(url)
        if response.status_code != 200:
            return {}
        return response.json()


async def discover_company_slug(careers_url: str) -> Optional[str]:
    """
    Try to find a company's Greenhouse slug from their careers page URL.
    Useful for adding new companies without manual lookup.
    """
    import re
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        try:
            response = await client.get(careers_url)
            # Look for greenhouse.io links in the page HTML
            matches = re.findall(
                r'boards\.greenhouse\.io/([a-zA-Z0-9_-]+)',
                response.text
            )
            if matches:
                return matches[0]
        except Exception:
            pass
    return None
```

---

### Step 3 — `backend/portals/greenhouse/apply.py`

Greenhouse application forms are standardised across all companies. The same Playwright handler works for every company:

```python
from playwright.async_api import async_playwright
from portals.naukri.jobs import Job
from ai.qa_answerer import answer_question
import asyncio
import random
import logging
import re

PROFILE_DIR = "./chrome_profiles/greenhouse"
logger = logging.getLogger(__name__)

async def greenhouse_apply(
    job: Job,
    resume_path: str,
    user_profile: dict,
    cover_letter: str = ""
) -> dict:
    """
    Apply to a Greenhouse job. The form is standardised:
    - Personal info fields (name, email, phone, location)
    - Resume upload
    - Optional cover letter
    - Optional custom questions
    - Submit button

    Most Greenhouse applies complete in 1 step (no multi-step wizard).
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            # Greenhouse job pages have an "Apply for this job" button
            apply_btn = await page.query_selector(
                "a:has-text('Apply for this job'), "
                "button:has-text('Apply for this job'), "
                "a:has-text('Apply Now'), "
                "#apply_button, "
                ".apply-button"
            )

            if apply_btn:
                await apply_btn.click()
                await page.wait_for_timeout(2000)

            # --- Standard Greenhouse form fields ---

            # First name
            await _fill_if_empty(page, "input#first_name", user_profile.get("name", "").split()[0])

            # Last name
            last_name = " ".join(user_profile.get("name", "Unknown").split()[1:]) or "."
            await _fill_if_empty(page, "input#last_name", last_name)

            # Email
            await _fill_if_empty(page, "input#email", user_profile.get("email", ""))

            # Phone
            await _fill_if_empty(page, "input#phone", user_profile.get("phone", ""))

            # Location / current city
            await _fill_if_empty(page, "input#job_application_location", user_profile.get("location", ""))

            # LinkedIn URL
            await _fill_if_empty(
                page,
                "input[name*='linkedin'], input[placeholder*='LinkedIn']",
                user_profile.get("linkedin_url", "")
            )

            # GitHub URL
            await _fill_if_empty(
                page,
                "input[name*='github'], input[placeholder*='GitHub']",
                user_profile.get("github_url", "")
            )

            # Website / portfolio
            await _fill_if_empty(
                page,
                "input[name*='website'], input[name*='portfolio']",
                user_profile.get("github_url", "")
            )

            # Resume upload
            resume_input = await page.query_selector(
                "input[type='file'][name*='resume'], input[type='file']#resume"
            )
            if resume_input:
                await resume_input.set_input_files(resume_path)
                await page.wait_for_timeout(1500)
                logger.info(f"[Greenhouse] Resume uploaded for {job.title}")

            # Cover letter (if field exists)
            cover_textarea = await page.query_selector(
                "textarea#cover_letter, textarea[name*='cover_letter']"
            )
            if cover_textarea and cover_letter:
                await cover_textarea.fill(cover_letter)

            # --- Custom questions (company-specific) ---
            # These vary per company but follow a standard pattern
            await _handle_custom_questions(page, user_profile)

            # --- Submit ---
            submit_btn = await page.query_selector(
                "input[type='submit']#submit_app, "
                "button[type='submit']:has-text('Submit Application'), "
                "button[type='submit']:has-text('Submit')"
            )

            if not submit_btn:
                await browser.close()
                return {"success": False, "reason": "No submit button found — form may have changed"}

            await submit_btn.click()
            await page.wait_for_timeout(4000)

            # Verify submission success
            success_el = await page.query_selector(
                ".application-confirmation, "
                "h1:has-text('Application submitted'), "
                "h2:has-text('Thank you'), "
                "p:has-text('successfully submitted')"
            )

            await browser.close()
            await asyncio.sleep(random.uniform(45, 120))

            if success_el:
                return {"success": True}
            else:
                # Some companies redirect to a confirmation page without a specific element
                if "confirmation" in page.url or "thank" in page.url.lower():
                    return {"success": True}
                return {
                    "success": False,
                    "reason": "Submit clicked but no confirmation found. May have succeeded — check manually."
                }

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            logger.error(f"[Greenhouse] Apply error for {job.title}: {e}")
            return {"success": False, "reason": str(e)}


async def _fill_if_empty(page, selector: str, value: str):
    """Fill a field only if it is currently empty and value is non-empty."""
    if not value:
        return
    try:
        el = await page.query_selector(selector)
        if el:
            current = await el.input_value()
            if not current:
                await el.fill(value)
                await page.wait_for_timeout(200)
    except Exception:
        pass


async def _handle_custom_questions(page, user_profile: dict):
    """
    Handle the custom questions section that companies add to their Greenhouse form.
    Questions follow a standard Greenhouse DOM structure.
    """
    question_blocks = await page.query_selector_all(".field, .question")

    for block in question_blocks:
        try:
            # Get question label
            label_el = await block.query_selector("label")
            label_text = (await label_el.inner_text()).strip() if label_el else ""

            if not label_text:
                continue

            # Text input
            text_inp = await block.query_selector("input[type='text'], input[type='number']")
            if text_inp:
                val = await text_inp.input_value()
                if not val:
                    answer = await answer_question(label_text, user_profile)
                    if answer:
                        await text_inp.fill(answer)
                        await page.wait_for_timeout(250)
                continue

            # Textarea
            textarea = await block.query_selector("textarea")
            if textarea:
                val = await textarea.input_value()
                if not val:
                    answer = await answer_question(label_text, user_profile)
                    if answer:
                        await textarea.fill(answer)
                continue

            # Select / dropdown
            select = await block.query_selector("select")
            if select:
                val = await select.input_value()
                if not val:
                    options = await select.query_selector_all("option")
                    if len(options) > 1:
                        # Try to pick a sensible option based on label
                        answer = await answer_question(label_text, user_profile)
                        matched = False
                        for opt in options[1:]:
                            opt_text = await opt.inner_text()
                            if answer.lower() in opt_text.lower():
                                await select.select_option(label=opt_text)
                                matched = True
                                break
                        if not matched:
                            await select.select_option(index=1)
                continue

            # Yes/No radio buttons
            radios = await block.query_selector_all("input[type='radio']")
            if radios:
                answer = await answer_question(label_text, user_profile)
                for radio in radios:
                    radio_label = await radio.get_attribute("value") or ""
                    if answer.lower() in radio_label.lower() or radio_label.lower() in answer.lower():
                        await radio.click()
                        break

        except Exception:
            continue
```

---

### Step 4 — Slug Discovery Utility

When you find a new company and want to add it to `companies.py`:

```python
# backend/portals/greenhouse/discover.py
# Run: python -m portals.greenhouse.discover https://careers.somecompany.com

import asyncio
import sys
from portals.greenhouse.jobs import discover_company_slug

async def main():
    if len(sys.argv) < 2:
        print("Usage: python discover.py <careers_page_url>")
        return
    url = sys.argv[1]
    slug = await discover_company_slug(url)
    if slug:
        print(f"Found Greenhouse slug: {slug}")
        print(f"Add to companies.py: \"{slug}\": {{\"name\": \"Company\", \"slug\": \"{slug}\"}}")
    else:
        print("No Greenhouse slug found — company may not use Greenhouse")

asyncio.run(main())
```

---

### Step 5 — Test Script

```python
# backend/test_greenhouse.py
import asyncio
from portals.greenhouse.jobs import search_greenhouse_jobs, get_job_detail
from portals.greenhouse.companies import GREENHOUSE_COMPANIES

async def main():
    print("=== Greenhouse Portal Test ===\n")

    # 1. Verify API is reachable with no auth
    print("Testing API access (no auth required)...")
    jobs = await search_greenhouse_jobs(
        keyword="",
        companies=["razorpay"],
        location_filter="india",
        max_per_company=5
    )
    assert len(jobs) > 0, "Razorpay Greenhouse API returned 0 jobs — slug may have changed"
    print(f"[PASS] Razorpay: {len(jobs)} jobs found")
    for j in jobs[:2]:
        print(f"       {j.title} | {j.location} | link: {j.apply_link}")
        assert j.job_id, "Missing job_id"
        assert j.apply_link.startswith("https://boards.greenhouse.io"), "Bad apply link"

    # 2. Keyword filter
    react_jobs = await search_greenhouse_jobs(
        keyword="React",
        companies=["swiggy", "meesho", "razorpay"],
        location_filter="india",
        max_per_company=10
    )
    print(f"\n[PASS] Keyword 'React' across 3 companies: {len(react_jobs)} jobs")
    for j in react_jobs[:3]:
        assert "react" in j.title.lower(), f"Keyword filter failed: got '{j.title}'"
        print(f"       [{j.company}] {j.title}")

    # 3. Multi-company search
    all_jobs = await search_greenhouse_jobs(
        keyword="engineer",
        companies=list(GREENHOUSE_COMPANIES.keys())[:5],
        location_filter="india",
        max_per_company=5
    )
    print(f"\n[PASS] Multi-company search: {len(all_jobs)} total jobs from first 5 companies")

    # 4. Job detail fetch
    if jobs:
        detail = await get_job_detail("razorpay", jobs[0].job_id)
        assert "title" in detail, "Job detail missing title"
        print(f"\n[PASS] Job detail fetch: {detail.get('title')}")
        print(f"       Description length: {len(detail.get('content', ''))} chars")

    # 5. 404 handling for unknown slug
    bad_jobs = await search_greenhouse_jobs(
        keyword="engineer",
        companies=["definitely_not_a_real_company_xyz"],
        location_filter="india"
    )
    assert bad_jobs == [], "Should return [] for unknown slug"
    print("\n[PASS] Unknown slug returns [] gracefully")

    print("\n=== All Greenhouse tests PASSED ===")

asyncio.run(main())
```

Run: `cd backend && python test_greenhouse.py`

Speed benchmark:
```bash
time python test_greenhouse.py
# Expected: under 10 seconds for 5 companies (pure HTTP, no browser)
# Compare: Naukri nkparam capture = 8 seconds alone (browser launch)
```

---

## Adding Greenhouse to the Scheduler

In `backend/scheduler/daily_fetch.py`, inside `_fetch_all_portals()`:

```python
# Greenhouse — no token required, always runs for all users
from portals.greenhouse.jobs import search_greenhouse_jobs

# Get user's preferred job titles for keyword search
keywords = prefs.get("job_titles", ["Software Engineer"])
greenhouse_jobs = await search_greenhouse_jobs(
    keyword=keywords[0] if keywords else "engineer",
    companies=None,  # search ALL companies in the registry
    location_filter="india",
    max_per_company=15
)
jobs.extend(greenhouse_jobs)
logger.info(f"[Greenhouse] {len(greenhouse_jobs)} jobs across all companies")
```

Note: Unlike Naukri or LinkedIn, Greenhouse requires **no connected portal token**. It runs for every user automatically.

---

## Expected Success Behaviour

- `search_greenhouse_jobs("React", ["razorpay"])` returns React jobs with titles containing "React"
- Each job has a valid `apply_link` starting with `https://boards.greenhouse.io`
- An unknown company slug returns `[]` with no exception
- Total fetch time for 10 companies is under 15 seconds (pure HTTP — no browser)
- `greenhouse_apply()` fills all standard fields (name, email, phone, resume) and returns `{"success": True}` on the confirmation page
- `discover_company_slug("https://careers.somecompany.com")` returns the slug when it's on Greenhouse

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `0 jobs` for a company | Slug is wrong or company left Greenhouse | Run `discover.py` on their careers URL to confirm slug; check if they switched to another ATS |
| Keyword filter returns unrelated titles | Greenhouse API has no server-side keyword filter — it's client-side | The `if keyword.lower() not in title.lower()` filter is correct; titles are exact so "engineer" won't match "SDE" — try broader keywords |
| `No submit button` on apply | Company uses a redirected external form (not Greenhouse native) | Some companies link to Greenhouse but redirect — follow the `apply_link`, check if it stays on `greenhouse.io` |
| Cover letter field not found | Company didn't add it to their form | Not an error — just skip it |
| `401` on job detail fetch | Some companies restrict detailed job data | Use the `jobs?content=true` list endpoint instead of individual detail endpoints |
| HTML in description | `content` field returns raw HTML | The `re.sub(r"<[^>]+>", " ", content)` strip above handles this |

## Challenges

- **No server-side keyword search**: The Greenhouse API returns ALL jobs for a company — keyword filtering is done client-side by checking if the keyword appears in the job title. This means if you search for "React", jobs titled "SDE-2 Frontend" won't match even if the description mentions React. Workaround: use broad keywords ("engineer", "developer", "frontend") and let the AI scorer rank them — the description fetch (`?content=true`) gives Claude the full JD.
- **Company slug changes**: If a company rebrands or is acquired, their Greenhouse slug may change. HCL would go from `hcl` to `hcltechltd` etc. The `404` handling returns `[]` gracefully, but you'll notice their jobs stop appearing. Build an alert: if a company that previously returned jobs now returns `404`, log a warning so you can update the slug.
- **Location filter misses remote jobs**: Some companies list India-based jobs as "Remote" without mentioning India. Searching with `location_filter="india"` will miss these. Either also include `location_filter=""` (no filter) or search twice — once with India filter, once for Remote, and deduplicate.
- **Rate limiting**: Greenhouse has no documented rate limit, but calling 25+ companies in rapid succession could trigger informal limits. Add a small `asyncio.sleep(0.2)` between company requests in the scheduler to be safe — still much faster than any browser-based approach.
- **Cover letter requirement**: Some companies mark the cover letter field as required. If `cover_letter=""`, the submit may fail with a validation error. Generate a basic cover letter via the AI layer before calling `greenhouse_apply()` — even a 2-sentence version works.
