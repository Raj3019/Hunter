import asyncio
import logging
from typing import List

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job

logger = logging.getLogger(__name__)


async def search_taleo_jobs(
    company_key: str,
    keyword: str,
    location: str = "",
    max_jobs: int = 20,
) -> List[Job]:
    from .companies import TALEO_COMPANIES

    company = TALEO_COMPANIES.get(company_key)
    if not company:
        logger.warning("Unknown Taleo company: %s", company_key)
        return []

    jobs: List[Job] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(20000)

        try:
            await page.goto(company["search_url"], wait_until="networkidle")
            await asyncio.sleep(2)

            frame = _find_taleo_frame(page)
            target = frame or page

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
                logger.warning("[Taleo/%s] Could not find keyword input", company_key)

            submit = await target.query_selector(
                "input[type='submit'], button[type='submit'], button:has-text('Search')"
            )
            if submit:
                await submit.click()
                await asyncio.sleep(3)

            frame = _find_taleo_frame(page)
            target = frame or page

            job_rows = await target.query_selector_all(
                "tr.listRow, tr.even, tr.odd, .jobListItem, .job-result-row"
            )

            if not job_rows:
                logger.warning("[Taleo/%s] No job rows found - selector may need updating", company_key)

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
                    logger.debug("Error parsing Taleo row: %s", e)
                    continue

        except Exception as e:
            logger.error("[Taleo/%s] Search failed: %s", company_key, e)
        finally:
            await browser.close()

    return jobs


def _find_taleo_frame(page):
    """
    Find the Taleo iframe context.
    IMPORTANT: Call this again after every page navigation -
    the old frame reference goes stale and raises errors.
    """
    for frame in page.frames:
        if "taleo" in frame.url and frame.url != page.url:
            return frame
    return None
