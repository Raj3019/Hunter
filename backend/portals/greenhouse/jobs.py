import logging
import re
from typing import List, Optional

import httpx

from portals.naukri.jobs import Job
from .companies import GREENHOUSE_API_BASE, GREENHOUSE_BOARD_BASE, GREENHOUSE_COMPANIES

logger = logging.getLogger(__name__)


async def search_greenhouse_jobs(
    keyword: str = "",
    companies: Optional[List[str]] = None,
    location_filter: str = "india",
    max_per_company: int = 20,
) -> List[Job]:
    """
    Search jobs across all or selected Greenhouse companies.
    No auth required. Returns clean structured Job objects.
    """
    targets = companies or list(GREENHOUSE_COMPANIES.keys())
    all_jobs: List[Job] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for company_key in targets:
            company = GREENHOUSE_COMPANIES.get(company_key)
            if not company:
                logger.warning("Unknown Greenhouse company key: %s", company_key)
                continue

            try:
                jobs = await _fetch_company_jobs(
                    client,
                    company_key,
                    company,
                    keyword,
                    location_filter,
                    max_per_company,
                )
                all_jobs.extend(jobs)
                logger.info("[Greenhouse/%s] %s jobs matched", company["name"], len(jobs))
            except Exception as e:
                logger.error("[Greenhouse/%s] Fetch failed: %s", company["name"], e)
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
        logger.warning("[Greenhouse] Slug '%s' not found - company may have left Greenhouse", slug)
        return []

    response.raise_for_status()
    data = response.json()
    raw_jobs = data.get("jobs", [])

    jobs: List[Job] = []
    for item in raw_jobs:
        title = item.get("title", "")
        location_name = item.get("location", {}).get("name", "")

        if keyword and keyword.lower() not in title.lower():
            continue

        if location_filter and location_filter.lower() not in location_name.lower():
            offices = [office.get("name", "") for office in item.get("offices", [])]
            if not any(location_filter.lower() in office.lower() for office in offices):
                continue

        job_id = str(item.get("id", ""))
        apply_link = item.get("absolute_url", f"{GREENHOUSE_BOARD_BASE}/{slug}/jobs/{job_id}")

        content = item.get("content", "")
        description = re.sub(r"<[^>]+>", " ", content).strip() if content else ""
        departments = [department.get("name", "") for department in item.get("departments", [])]

        jobs.append(Job(
            job_id=job_id,
            title=title,
            company=company["name"],
            location=location_name,
            experience="",
            salary="",
            posted_date=item.get("updated_at", ""),
            apply_link=apply_link,
            description=description[:2000],
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
    """Try to find a company's Greenhouse slug from its careers page URL."""
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
        try:
            response = await client.get(careers_url)
            matches = re.findall(
                r"(?:boards|job-boards)\.greenhouse\.io/([a-zA-Z0-9_-]+)",
                response.text,
            )
            if matches:
                return matches[0]
        except Exception:
            pass
    return None
