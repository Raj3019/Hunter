from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/linkedin"


async def is_session_active() -> bool:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=True,
        )
        page = await browser.new_page()
        await page.goto("https://www.linkedin.com/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        logged_in = "feed" in page.url and "login" not in page.url
        await browser.close()
        return logged_in
