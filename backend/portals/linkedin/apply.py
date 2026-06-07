import logging

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job

try:
    from ai.qa_answerer import answer_question
except ImportError:
    async def answer_question(question: str, user_profile: dict) -> str:
        return str(user_profile.get(question) or user_profile.get("default_answer") or "")


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

            easy_apply_btn = await page.query_selector(
                "button:has-text('Easy Apply'), .jobs-apply-button:has-text('Easy Apply')"
            )
            if not easy_apply_btn:
                await browser.close()
                return {
                    "success": False,
                    "external_pending": True,
                    "apply_method": "external",
                    "reason": "This LinkedIn job does not support Easy Apply. Complete it on the external company site.",
                    "external_apply_url": job.apply_link,
                }

            await easy_apply_btn.click()
            await page.wait_for_timeout(2000)

            for step in range(10):
                await page.wait_for_timeout(1500)

                modal = await page.query_selector(".jobs-easy-apply-modal, [data-test-modal]")
                if not modal:
                    break

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

                selects = await page.query_selector_all(".jobs-easy-apply-modal select")
                for sel in selects:
                    val = await sel.input_value()
                    if not val:
                        try:
                            await sel.select_option(index=1)
                        except Exception:
                            pass

                submit_btn = await page.query_selector("button:has-text('Submit application')")
                next_btn = await page.query_selector("button:has-text('Next')")
                review_btn = await page.query_selector("button:has-text('Review')")

                if submit_btn:
                    await submit_btn.click()
                    await page.wait_for_timeout(3000)
                    await browser.close()
                    return {"success": True}
                if next_btn:
                    await next_btn.click()
                elif review_btn:
                    await review_btn.click()
                else:
                    logger.warning("No navigation button found at step %s", step + 1)
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete Easy Apply form"}

        except Exception as e:
            await browser.close()
            logger.error("LinkedIn Easy Apply error: %s", e)
            return {"success": False, "reason": str(e)}
