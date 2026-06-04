import os

from playwright.sync_api import expect, sync_playwright


ROOT = os.environ.get("FRONTEND_URL", "http://127.0.0.1:3001")


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.goto(f"{ROOT}/auth", wait_until="networkidle")
        page.evaluate("localStorage.setItem('access_token', 'demo-token')")
        page.goto(f"{ROOT}/dashboard", wait_until="networkidle")

        for label, heading in [
            ("Jobs", "Job matches"),
            ("Tracker", "Application Tracker"),
            ("Portals", "Portal Connections"),
            ("Settings", "Settings"),
            ("Dashboard", "Today’s workspace"),
        ]:
            page.get_by_role("link", name=label).click()
            expect(page.get_by_role("heading", name=heading)).to_be_visible()

        page.get_by_role("button", name="Notifications").click()
        expect(page.get_by_text("Portal check needed")).to_be_visible()
        page.get_by_text("3 matches ready").click()
        expect(page.get_by_role("heading", name="Job matches")).to_be_visible()

        page.get_by_role("button", name="Profile").click()
        page.get_by_role("button", name="Onboarding").click()
        expect(page.get_by_role("heading", name="Resume & Preferences")).to_be_visible()

        page.goto(f"{ROOT}/dashboard", wait_until="networkidle")
        page.get_by_role("button", name="Queue 1").click()
        expect(page.get_by_role("heading", name="Application Tracker")).to_be_visible()

        page.goto(f"{ROOT}/dashboard", wait_until="networkidle")
        page.get_by_role("button", name="Sync").click()
        expect(page.get_by_role("button", name="Syncing")).to_be_visible()

        page.set_viewport_size({"width": 390, "height": 900})
        page.goto(f"{ROOT}/dashboard", wait_until="networkidle")
        page.get_by_role("button", name="Open navigation").click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.get_by_role("link", name="Jobs").click()
        expect(page.get_by_role("heading", name="Job matches")).to_be_visible()

        browser.close()
        print("navbar verification passed")


if __name__ == "__main__":
    main()
