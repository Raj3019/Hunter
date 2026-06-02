import asyncio
from typing import List
from urllib.parse import quote

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job

PROFILE_DIR = "./chrome_profiles/linkedin"

EXPERIENCE_MAP = {
    "internship": "1",
    "entry": "2",
    "associate": "3",
    "mid-senior": "4",
    "director": "5",
    "executive": "6",
}


async def search_linkedin_jobs(
    keyword: str,
    location: str = "India",
    experience_level: str = "entry",
    max_jobs: int = 50,
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

        await page.goto("https://www.linkedin.com/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        if "login" in page.url:
            await browser.close()
            raise RuntimeError("LinkedIn session expired - user must run setup_session.py again")

        search_url = (
            "https://www.linkedin.com/jobs/search/"
            f"?keywords={quote(keyword)}"
            f"&location={quote(location)}"
            f"&f_E={exp_code}"
            "&f_LF=f_AL"
            "&sortBy=DD"
        )
        await page.goto(search_url, wait_until="networkidle")
        await asyncio.sleep(4)

        for _ in range(3):
            await page.keyboard.press("End")
            await asyncio.sleep(2)
            if len(captured_jobs) >= max_jobs:
                break

        await browser.close()

    return captured_jobs[:max_jobs]


def _extract_jobs_from_voyager(data: dict, jobs: List[Job]):
    elements = data.get("elements", [])
    seen_ids = {job.job_id for job in jobs}

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

        if job_id and title and job_id not in seen_ids:
            jobs.append(Job(
                job_id=job_id,
                title=title,
                company=company,
                location=location,
                experience="",
                salary="",
                posted_date=str(listed_at),
                apply_link=apply_link,
                description="",
                portal="linkedin",
            ))
            seen_ids.add(job_id)
