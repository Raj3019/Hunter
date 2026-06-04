import os
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = os.environ.get("FRONTEND_URL", "http://127.0.0.1:3001")
SCREENSHOT_DIR = Path(__file__).resolve().parents[1] / "screenshots"


def main() -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})

        checks = {}
        for route, name in [
            ("/", "home"),
            ("/auth", "auth"),
        ]:
            page.goto(f"{ROOT}{route}", wait_until="networkidle")
            checks[name] = page.locator("h1").first.text_content()
            page.screenshot(path=str(SCREENSHOT_DIR / f"hunter-{name}.png"), full_page=True)

        page.evaluate("localStorage.setItem('access_token', 'demo-token')")
        for route, name in [
            ("/dashboard", "dashboard"),
            ("/jobs", "jobs"),
            ("/tracker", "tracker"),
            ("/portals", "portals"),
            ("/settings", "settings"),
            ("/onboarding", "onboarding"),
        ]:
            page.goto(f"{ROOT}{route}", wait_until="networkidle")
            checks[name] = page.locator("h1").first.text_content()
            page.screenshot(path=str(SCREENSHOT_DIR / f"hunter-{name}.png"), full_page=True)

        page.evaluate("localStorage.setItem('hunter_theme', 'light'); document.documentElement.dataset.theme = 'light'")
        page.goto(f"{ROOT}/dashboard", wait_until="networkidle")
        checks["dashboard_light"] = page.locator("h1").first.text_content()
        page.screenshot(path=str(SCREENSHOT_DIR / "hunter-dashboard-light.png"), full_page=True)

        page.set_viewport_size({"width": 390, "height": 900})
        page.goto(f"{ROOT}/jobs", wait_until="networkidle")
        checks["jobs_mobile"] = page.locator("h1").first.text_content()
        page.screenshot(path=str(SCREENSHOT_DIR / "hunter-jobs-mobile.png"), full_page=True)

        browser.close()
        print(checks)


if __name__ == "__main__":
    main()
