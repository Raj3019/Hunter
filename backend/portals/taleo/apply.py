import logging

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job
from portals.taleo.jobs import _find_taleo_frame

try:
    from ai.qa_answerer import answer_question
except ImportError:
    async def answer_question(question: str, user_profile: dict) -> str:
        return str(user_profile.get(question) or user_profile.get("default_answer") or "")


PROFILE_DIR = "./chrome_profiles/taleo"
logger = logging.getLogger(__name__)


async def taleo_apply(job: Job, resume_path: str, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
        )
        page = await browser.new_page()
        page.set_default_timeout(15000)

        try:
            await page.goto(job.apply_link, wait_until="networkidle")
            await page.wait_for_timeout(2000)

            frame = _find_taleo_frame(page)
            target = frame or page

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
                external_url = page.url
                await browser.close()
                return {
                    "success": False,
                    "external_pending": True,
                    "apply_method": "external",
                    "reason": "No supported Taleo Apply button was found. Complete this job manually on the company site.",
                    "external_apply_url": external_url,
                }

            for step in range(12):
                await page.wait_for_timeout(2000)

                frame = _find_taleo_frame(page)
                target = frame or page

                file_input = await page.query_selector("input[type='file']")
                if file_input:
                    await file_input.set_input_files(resume_path)
                    await page.wait_for_timeout(1500)

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
                            await inp.get_attribute("name") or
                            ""
                        )
                        if label:
                            answer = await answer_question(label, user_profile)
                            if answer:
                                await inp.fill(answer)
                                await page.wait_for_timeout(300)
                    except Exception:
                        continue

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
                    success_el = await _find_success_indicator(page)
                    final_url = page.url
                    await browser.close()
                    if success_el:
                        return {"success": True}
                    return {
                        "success": False,
                        "external_pending": True,
                        "apply_method": "external",
                        "reason": "Taleo submission needs manual confirmation. Open the company site and confirm whether the application completed.",
                        "external_apply_url": final_url,
                    }
                if next_btn:
                    await next_btn.click()
                else:
                    logger.warning("[Taleo] No navigation at step %s", step + 1)
                    break

            external_url = page.url
            await browser.close()
            return {
                "success": False,
                "external_pending": True,
                "apply_method": "external",
                "reason": "Could not complete the Taleo form automatically. Continue manually on the company site.",
                "external_apply_url": external_url,
            }

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            return {"success": False, "reason": str(e)}


async def _find_success_indicator(page):
    for selector in (
        "text=/application submitted/i",
        "text=/thank you/i",
        "text=/successfully submitted/i",
        "text=/application complete/i",
    ):
        try:
            indicator = await page.query_selector(selector)
            if indicator:
                return indicator
        except Exception:
            continue
    return None
