import logging

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job
from .account_login import is_session_active, login_to_company_portal
from .registry import COMPANY_PORTALS

try:
    from ai.qa_answerer import answer_question
except ImportError:
    async def answer_question(question: str, user_profile: dict) -> str:
        return str(user_profile.get(question) or user_profile.get("default_answer") or "")


BASE_PROFILE_DIR = "./chrome_profiles/companies"
logger = logging.getLogger(__name__)


async def apply_with_company_account(
    company_key: str,
    job: Job,
    resume_path: str,
    user_profile: dict,
    username: str,
    password_encrypted: str,
) -> dict:
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return {"success": False, "reason": "Unknown company"}

    session_ok = await is_session_active(company_key)
    if not session_ok:
        login_result = await login_to_company_portal(company_key, username, password_encrypted)
        if not login_result["success"]:
            return {"success": False, "reason": f"Login failed: {login_result['reason']}"}

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

            apply_selectors = [
                "button:has-text('Apply')",
                "a:has-text('Apply Now')",
                "button:has-text('Apply Now')",
                "input[value='Apply']",
                "input[value='Apply Now']",
            ]
            clicked = False
            for selector in apply_selectors:
                try:
                    await page.click(selector, timeout=3000)
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

                inputs = await page.query_selector_all(
                    "input[type='text']:not([readonly]):not([disabled]), "
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
                            await inp.get_attribute("placeholder") or
                            await inp.get_attribute("name") or
                            ""
                        )
                        if label:
                            answer = await answer_question(label, user_profile)
                            if answer:
                                await inp.fill(answer)
                                await page.wait_for_timeout(350)
                    except Exception:
                        continue

                selects = await page.query_selector_all("select:not([disabled])")
                for sel in selects:
                    try:
                        val = await sel.input_value()
                        if not val:
                            options = await sel.query_selector_all("option")
                            if len(options) > 1:
                                await sel.select_option(index=1)
                    except Exception:
                        continue

                submit = await page.query_selector(
                    "button[type='submit']:has-text('Submit'), "
                    "button:has-text('Submit Application'), "
                    "input[type='submit'][value*='Submit']"
                )
                next_btn = await page.query_selector(
                    "button:has-text('Next'), button:has-text('Continue'), "
                    "button:has-text('Save and Continue'), input[value='Next']"
                )

                if submit:
                    await submit.click()
                    await page.wait_for_timeout(3000)
                    await browser.close()
                    return {"success": True}
                if next_btn:
                    await next_btn.click()
                else:
                    logger.warning("No navigation at step %s for %s", step + 1, job.title)
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete application form"}

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            logger.error("Company apply error (%s): %s", company_key, e)
            return {"success": False, "reason": str(e)}
