from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = "http://127.0.0.1:3001"
SCREENSHOT_DIR = Path(__file__).resolve().parents[1] / "screenshots"


def main() -> None:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 900})
        page.goto(f"{ROOT}/auth", wait_until="networkidle")
        page.evaluate(
            """
            localStorage.setItem('access_token', 'demo-token');
            localStorage.setItem('hunter_theme', 'light');
            document.documentElement.dataset.theme = 'light';
            """
        )

        page.goto(f"{ROOT}/dashboard", wait_until="networkidle")
        page.get_by_role("button", name="Profile").click()
        page.screenshot(path=str(SCREENSHOT_DIR / "hunter-profile-menu-fixed.png"), full_page=True)

        page.goto(f"{ROOT}/onboarding", wait_until="networkidle")
        page.screenshot(path=str(SCREENSHOT_DIR / "hunter-onboarding-fixed.png"), full_page=True)

        browser.close()
        print("layout screenshots captured")


if __name__ == "__main__":
    main()
