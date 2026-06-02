import logging

from playwright.async_api import async_playwright

from core.encryption import decrypt

logger = logging.getLogger(__name__)
BASE_PROFILE_DIR = "./chrome_profiles/companies"


async def login_to_company_portal(
    company_key: str,
    username: str,
    password_encrypted: str,
) -> dict:
    from .registry import COMPANY_PORTALS

    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return {"success": False, "reason": f"Unknown company key: {company_key}"}

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
        )
        page = await browser.new_page()

        try:
            await page.goto(company["login_url"], wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            already_in = await page.query_selector(company["success_indicator"])
            if already_in:
                logger.info("Already logged in to %s", company["name"])
                await browser.close()
                return {"success": True, "reason": "Existing session still active"}

            await page.fill(company["username_selector"], username)
            await page.wait_for_timeout(500)

            password = decrypt(password_encrypted)
            try:
                await page.fill(company["password_selector"], password)
            finally:
                del password

            await page.wait_for_timeout(500)
            await page.click(company["submit_selector"])
            await page.wait_for_timeout(4000)

            logged_in = await page.query_selector(company["success_indicator"])
            current_url = page.url

            await browser.close()

            if logged_in:
                logger.info("Login successful: %s", company["name"])
                return {"success": True, "reason": "Logged in successfully"}
            return {
                "success": False,
                "reason": f"Login may have failed. Current URL: {current_url}",
            }

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            logger.error("Login error for %s: %s", company["name"], e)
            return {"success": False, "reason": str(e)}


async def is_session_active(company_key: str) -> bool:
    from .registry import COMPANY_PORTALS

    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return False

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=True,
        )
        page = await browser.new_page()

        try:
            await page.goto(company["login_url"], wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)
            logged_in = await page.query_selector(company["success_indicator"])
            await browser.close()
            return bool(logged_in)
        except Exception:
            await browser.close()
            return False
