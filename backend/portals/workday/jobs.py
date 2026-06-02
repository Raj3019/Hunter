import asyncio
from typing import List

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

from portals.naukri.jobs import Job

PROFILE_DIR = "./chrome_profiles/workday"


async def search_workday_jobs(
    company_key: str,
    keyword: str,
    location: str = "India",
    max_jobs: int = 30,
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
            headless=True,
        )
        try:
            page = await browser.new_page()
            page.set_default_timeout(10000)
            page.set_default_navigation_timeout(20000)

            async def on_response(response):
                if "myworkdayjobs.com" in response.url and "/jobs" in response.url and response.status == 200:
                    try:
                        data = await response.json()
                        captured.append(data)
                    except Exception:
                        pass

            page.on("response", on_response)

            try:
                await page.goto(company["careers_url"], wait_until="domcontentloaded", timeout=20000)
            except PlaywrightTimeoutError:
                return []

            await asyncio.sleep(3)

            search_selectors = [
                f"input[placeholder*='Search'], input[name='{company.get('search_keyword_param', 'q')}']",
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
                        await asyncio.sleep(4)
                        break
                except Exception:
                    continue

            for data in captured:
                _extract_jobs_from_workday_response(data, company, location, jobs, max_jobs)
                if len(jobs) >= max_jobs:
                    break
        finally:
            await browser.close()

    return jobs


def _extract_jobs_from_workday_response(
    data: dict,
    company: dict,
    location: str,
    jobs: List[Job],
    max_jobs: int,
):
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
