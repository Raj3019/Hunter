import logging

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job

try:
    from ai.qa_answerer import answer_question
except ImportError:
    async def answer_question(question: str, user_profile: dict) -> str:
        return str(user_profile.get(question) or user_profile.get("default_answer") or "")


PROFILE_DIR = "./chrome_profiles/workday"
logger = logging.getLogger(__name__)


async def workday_apply(job: Job, resume_path: str, user_profile: dict) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

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

            for step in range(15):
                await page.wait_for_timeout(2000)

                file_input = await page.query_selector("input[type='file']")
                if file_input:
                    await file_input.set_input_files(resume_path)
                    await page.wait_for_timeout(1500)

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

                wd_dropdowns = await page.query_selector_all(
                    "[data-automation-id='promptOption']:not([aria-selected='true'])"
                )
                for dd in wd_dropdowns[:3]:
                    try:
                        await dd.click()
                        await page.wait_for_timeout(300)
                    except Exception:
                        pass

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
                    return {"success": True}
                if next_btn:
                    await next_btn.click()
                else:
                    logger.warning("Workday: no navigation button at step %s for %s", step + 1, job.title)
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete Workday form"}

        except Exception as e:
            await browser.close()
            logger.error("Workday apply error for %s: %s", job.title, e)
            return {"success": False, "reason": str(e)}
