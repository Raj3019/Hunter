import asyncio

from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/linkedin"


async def setup():
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = await browser.new_page()
        await page.goto("https://www.linkedin.com/login")
        print("Please log in to LinkedIn in the browser window that just opened.")
        print("Complete any 2FA if prompted.")
        print("Once you can see your LinkedIn feed, press Enter here...")
        input()

        await page.goto("https://www.linkedin.com/feed")
        await page.wait_for_timeout(2000)
        if "feed" in page.url:
            print("[OK] Session saved successfully to:", PROFILE_DIR)
        else:
            print("[WARN] May not be fully logged in. URL:", page.url)
        await browser.close()


asyncio.run(setup())
