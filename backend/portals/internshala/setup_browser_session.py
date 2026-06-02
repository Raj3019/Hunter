import asyncio

from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/internshala"


async def setup():
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
        )
        page = await browser.new_page()
        await page.goto("https://internshala.com/login")
        print("Please log in manually in the browser window.")
        print("Press Enter here once you are logged in and can see your dashboard...")
        input()
        await browser.close()
        print("Session saved to:", PROFILE_DIR)


asyncio.run(setup())
