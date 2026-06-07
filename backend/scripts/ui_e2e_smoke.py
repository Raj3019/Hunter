"""
Playwright UI smoke test for Hunter's assist-only MVP.

Required env:
  HUNTER_E2E_EMAIL or HUNTER_TEST_EMAIL
  HUNTER_E2E_PASSWORD or HUNTER_TEST_PASSWORD

Optional env:
  HUNTER_E2E_BASE_URL=http://127.0.0.1:3000
  HUNTER_E2E_API_URL=http://127.0.0.1:8000
  HUNTER_E2E_HEADLESS=0
  HUNTER_E2E_RUN_SEARCH=1
  HUNTER_E2E_SEARCH_QUERY=frontend developer
  HUNTER_E2E_LOCATION=
  HUNTER_E2E_PORTAL_FLOW=1
  HUNTER_E2E_SEED_MATCH=0
  HUNTER_E2E_CONFIRM_OUTCOME=none  # none | applied | failed
  HUNTER_E2E_WAIT_AUTO_SYNC_MS=65000

The test clicks through the real UI. It never submits a portal application.
If seeded mode is enabled, the confirmation flow can safely update and clean up
the seeded job/application without touching a real application outcome.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, expect, sync_playwright


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
ARTIFACT_DIR = BACKEND_ROOT / "test-artifacts" / "ui-e2e"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

if os.getenv("HUNTER_E2E_USE_PROJECT_BROWSERS") == "1":
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(BACKEND_ROOT / ".playwright-browsers"))


BASE_URL = os.getenv("HUNTER_E2E_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
API_URL = os.getenv("HUNTER_E2E_API_URL", "http://127.0.0.1:8000").rstrip("/")
EMAIL = os.getenv("HUNTER_E2E_EMAIL") or os.getenv("HUNTER_TEST_EMAIL", "")
PASSWORD = os.getenv("HUNTER_E2E_PASSWORD") or os.getenv("HUNTER_TEST_PASSWORD", "")
HEADLESS = os.getenv("HUNTER_E2E_HEADLESS", "0") == "1"
RUN_SEARCH = os.getenv("HUNTER_E2E_RUN_SEARCH", "1") == "1"
SEARCH_QUERY = os.getenv("HUNTER_E2E_SEARCH_QUERY", "frontend developer")
SEARCH_LOCATION = os.getenv("HUNTER_E2E_LOCATION", "")
PORTAL_FLOW = os.getenv("HUNTER_E2E_PORTAL_FLOW", "1") == "1"
SEED_MATCH = os.getenv("HUNTER_E2E_SEED_MATCH", "0") == "1"
CONFIRM_OUTCOME = os.getenv(
    "HUNTER_E2E_CONFIRM_OUTCOME",
    "failed" if SEED_MATCH else "none",
).strip().lower()
TARGET_TEXT = os.getenv(
    "HUNTER_E2E_TARGET_TEXT",
    "Frontend Engineer - Hunter Seed" if SEED_MATCH else "",
).strip()
WAIT_AUTO_SYNC_MS = int(os.getenv("HUNTER_E2E_WAIT_AUTO_SYNC_MS", "65000"))


SAFE_AUTO_SYNC_PATHS = {
    "/api/jobs/matches",
    "/api/applications",
    "/api/portals/status",
}
UNSAFE_AUTO_SYNC_MARKERS = (
    "/api/jobs/search",
    "/open-portal",
    "/apply",
)


@dataclass
class ApiCall:
    at: float
    method: str
    url: str
    status: int | None = None

    @property
    def path(self) -> str:
        return urlparse(self.url).path


@dataclass
class RunReport:
    steps: list[str] = field(default_factory=list)
    api_calls: list[ApiCall] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def step(self, message: str) -> None:
        self.steps.append(message)
        print(f"[PASS] {message}")

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"[WARN] {message}")


def main() -> int:
    if not EMAIL or not PASSWORD:
        print("[FAIL] Set HUNTER_E2E_EMAIL/HUNTER_E2E_PASSWORD or HUNTER_TEST_EMAIL/HUNTER_TEST_PASSWORD.")
        return 2

    if CONFIRM_OUTCOME not in {"none", "applied", "failed"}:
        print("[FAIL] HUNTER_E2E_CONFIRM_OUTCOME must be one of: none, applied, failed.")
        return 2

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    report = RunReport()

    print(f"[INFO] Frontend: {BASE_URL}")
    print(f"[INFO] Backend:  {API_URL}")
    wait_for_servers()

    seeded_user_id = ""
    if SEED_MATCH:
        seeded_user_id = seed_match_for_email(EMAIL)
        report.step("Seeded a safe pending match for portal/tracker UI verification")

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS, slow_mo=120 if not HEADLESS else 0)
            context = browser.new_context(viewport={"width": 1440, "height": 920})
            page = context.new_page()
            wire_api_recording(page, report)
            wire_popup_autoclose(context, report)

            try:
                login(page, report)
                verify_shell(page, report)
                verify_jobs_flow(page, report)
                if PORTAL_FLOW:
                    verify_open_portal_flow(page, report)
                    verify_tracker_confirmation(page, report)
                else:
                    report.step("Skipped portal/tracker mutation flow by configuration")
                verify_auto_sync(page, report)

                wait_for_live_data_idle(page, report)
                page.screenshot(path=str(ARTIFACT_DIR / "final.png"), full_page=True)
                report.step(f"Saved final screenshot to {ARTIFACT_DIR / 'final.png'}")
            except Exception:
                page.screenshot(path=str(ARTIFACT_DIR / "failure.png"), full_page=True)
                print(f"[INFO] Saved failure screenshot to {ARTIFACT_DIR / 'failure.png'}")
                print_recent_api_calls(report)
                write_report(report)
                raise
            finally:
                browser.close()
    finally:
        if SEED_MATCH and seeded_user_id:
            cleanup_seed_match(seeded_user_id)

    write_report(report)
    if report.warnings:
        print(f"[INFO] Completed with {len(report.warnings)} warning(s).")
    print("[PASS] UI E2E smoke completed")
    return 0


def wait_for_servers() -> None:
    for label, url in [("backend", f"{API_URL}/health"), ("frontend", BASE_URL)]:
        for _ in range(30):
            try:
                response = requests.get(url, timeout=5)
                if response.status_code < 500:
                    print(f"[INFO] {label} is reachable")
                    break
            except requests.RequestException:
                time.sleep(1)
        else:
            raise RuntimeError(f"{label} is not reachable at {url}")


def wire_api_recording(page: Page, report: RunReport) -> None:
    calls_by_request: dict[Any, ApiCall] = {}

    def on_request(request: Any) -> None:
        if is_hunter_api_url(request.url):
            call = ApiCall(time.monotonic(), request.method, request.url)
            calls_by_request[request] = call
            report.api_calls.append(call)

    def on_response(response: Any) -> None:
        call = calls_by_request.get(response.request)
        if call:
            call.status = response.status

    page.on("request", on_request)
    page.on("response", on_response)


def wire_popup_autoclose(context: Any, report: RunReport) -> None:
    def on_page(popup: Page) -> None:
        try:
            popup.wait_for_load_state("domcontentloaded", timeout=8000)
            report.step(f"Portal tab opened: {popup.url}")
        except PlaywrightTimeoutError:
            report.warn("Portal tab opened but did not finish loading quickly")
        except PlaywrightError:
            return
        try:
            popup.close()
        except Exception:
            pass

    context.on("page", on_page)


def wait_for_live_data_idle(page: Page, report: RunReport) -> None:
    try:
        expect(page.get_by_text("Loading live Hunter data...")).not_to_be_visible(timeout=15000)
    except PlaywrightTimeoutError:
        report.warn("Live data banner was still visible when the final screenshot was captured.")


def login(page: Page, report: RunReport) -> None:
    page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
    expect(page.get_by_role("heading", name="Sign in")).to_be_visible(timeout=15000)
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Continue").click()
    try:
        page.wait_for_url("**/dashboard", timeout=35000)
    except PlaywrightTimeoutError as exc:
        error = visible_text(page, "Network Error") or visible_text(page, "Could not sign in") or "login did not reach Dashboard"
        raise RuntimeError(error) from exc
    expect(page.get_by_text("Today")).to_be_visible(timeout=20000)
    report.step("Signed into Hunter through the UI")


def verify_shell(page: Page, report: RunReport) -> None:
    expect(page.get_by_role("link", name="Jobs")).to_be_visible()
    expect(page.get_by_role("link", name="Tracker")).to_be_visible()
    expect(page.get_by_role("button", name=re.compile(r"(Auto sync|Syncing|Paused|Updated)"))).to_be_visible()
    report.step("Authenticated app shell renders navigation and Auto sync control")


def verify_jobs_flow(page: Page, report: RunReport) -> None:
    page.get_by_role("link", name="Jobs").click()
    expect(page.get_by_role("heading", name="Job matches")).to_be_visible(timeout=20000)
    expect(page.get_by_text("Search live jobs", exact=True)).to_be_visible()
    report.step("Jobs page opened from navigation")

    if RUN_SEARCH:
        if SEARCH_QUERY:
            page.get_by_placeholder("frontend developer, DevOps, React").fill(SEARCH_QUERY)
        if SEARCH_LOCATION:
            page.get_by_placeholder("Mumbai, Pune, Remote").fill(SEARCH_LOCATION)
        with page.expect_response(
            lambda response: response_path(response.url) == "/api/jobs/search" and response.request.method == "POST",
            timeout=210000,
        ) as response_info:
            page.get_by_role("button", name="Search", exact=True).click()
        response = response_info.value
        if response.status >= 400:
            raise RuntimeError(f"Search failed with HTTP {response.status}: {response.text()[:500]}")
        body = response.json()
        run = body.get("run") or {}
        fetched = int(run.get("fetched_count") or 0)
        saved = int(run.get("saved_matches_count") or 0)
        if fetched <= 0:
            raise RuntimeError("Search completed but fetched zero jobs.")
        expect(page.get_by_role("button", name="Searching", exact=True)).not_to_be_visible(timeout=120000)
        report.step(f"Manual search completed through the Jobs UI: fetched={fetched}, saved={saved}")

    all_results = page.get_by_role("button", name=re.compile(r"All results"))
    if all_results.count():
        all_results.first.click()
        report.step("Switched to All results")

    if TARGET_TEXT:
        expect(page.get_by_text(TARGET_TEXT).first).to_be_visible(timeout=30000)
        target_row = page.get_by_role("button").filter(has_text=TARGET_TEXT)
        if not target_row.count():
            raise RuntimeError(f"Target job row was not found: {TARGET_TEXT}")
        target_row.first.click()
        expect(page.get_by_text(TARGET_TEXT).first).to_be_visible(timeout=15000)
        report.step(f"Selected target job: {TARGET_TEXT}")
    if PORTAL_FLOW:
        expect(page.get_by_role("button", name="Open portal").first).to_be_visible(timeout=30000)
        report.step("A selected job exposes the portal-first action")


def verify_open_portal_flow(page: Page, report: RunReport) -> None:
    open_buttons = page.get_by_role("button", name="Open portal")
    if not open_buttons.count():
        raise RuntimeError("Open portal button missing")

    with page.expect_response(
        lambda response: (
            ("/api/jobs/" in response_path(response.url) and "/open-portal" in response_path(response.url))
            or response_path(response.url) == "/api/jobs/open-portal-snapshot"
        ),
        timeout=45000,
    ) as response_info:
        open_buttons.first.click()
    response = response_info.value
    if response.status >= 400:
        raise RuntimeError(f"Open portal failed with HTTP {response.status}: {response.text()[:500]}")

    expect(page.get_by_text("Portal pending").first).to_be_visible(timeout=20000)
    report.step("Open portal created a portal-pending task through the UI")


def verify_tracker_confirmation(page: Page, report: RunReport) -> None:
    page.get_by_role("link", name="Tracker").click()
    expect(page.get_by_role("heading", name="Application tracker")).to_be_visible(timeout=20000)
    portal_pending = page.get_by_role("button", name=re.compile(r"Portal pending"))
    if portal_pending.count():
        portal_pending.first.click()
    expect(page.get_by_text("Application details")).to_be_visible(timeout=20000)
    report.step("Tracker shows the portal-pending application")

    if CONFIRM_OUTCOME == "none":
        report.warn("Skipped outcome confirmation; set HUNTER_E2E_CONFIRM_OUTCOME=applied or failed to click a confirmation button.")
        return

    button_name = "I applied" if CONFIRM_OUTCOME == "applied" else "Could not apply"
    target_status = "applied" if CONFIRM_OUTCOME == "applied" else "failed"
    with page.expect_response(
        lambda response: response_path(response.url).startswith("/api/applications/") and response.request.method == "PATCH",
        timeout=45000,
    ) as response_info:
        page.get_by_role("button", name=button_name).click()
    response = response_info.value
    if response.status >= 400:
        raise RuntimeError(f"Tracker confirmation failed with HTTP {response.status}: {response.text()[:500]}")
    page.wait_for_timeout(1200)
    stage_label = "Applied" if target_status == "applied" else "Failed"
    stage_button = page.get_by_role("button", name=re.compile(stage_label))
    expect(stage_button.first).to_be_visible(timeout=15000)
    stage_button.first.click()
    if TARGET_TEXT:
        expect(page.get_by_text(TARGET_TEXT).first).to_be_visible(timeout=20000)
    report.step(f"Tracker confirmation updated the application to {target_status}")


def verify_auto_sync(page: Page, report: RunReport) -> None:
    start = time.monotonic()
    page.wait_for_timeout(WAIT_AUTO_SYNC_MS)
    calls = [call for call in report.api_calls if call.at >= start]
    unsafe = [call for call in calls if any(marker in call.path for marker in UNSAFE_AUTO_SYNC_MARKERS)]
    safe = [call for call in calls if call.path in SAFE_AUTO_SYNC_PATHS]

    if unsafe:
        details = ", ".join(f"{call.method} {call.path}" for call in unsafe)
        raise RuntimeError(f"Auto sync made unsafe calls: {details}")

    if not safe:
        report.warn("No auto-sync API calls were observed in the wait window.")
    else:
        details = ", ".join(sorted({f"{call.method} {call.path}" for call in safe}))
        report.step(f"Auto sync stayed on safe read endpoints: {details}")


def seed_match_for_email(email: str) -> str:
    import scripts.seed_live_match as seed_live_match

    db = seed_live_match.get_db()
    user_id = login_for_user_id()
    if not user_id:
        raise RuntimeError("Could not resolve authenticated user id for seeded E2E run.")
    job_id = seed_live_match.upsert_seed_job(db)
    seed_live_match.upsert_seed_match(db, user_id, job_id)
    return user_id


def login_for_user_id() -> str:
    response = requests.post(
        f"{API_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    response.raise_for_status()
    return str(response.json().get("user_id") or "")


def cleanup_seed_match(user_id: str) -> None:
    import scripts.seed_live_match as seed_live_match

    db = seed_live_match.get_db()
    existing = db.table("jobs").select("id").eq("portal", seed_live_match.SEED_PORTAL).eq(
        "job_id",
        seed_live_match.SEED_JOB_ID,
    ).maybe_single().execute()
    job_id = (existing.data or {}).get("id")
    if job_id:
        db.table("applications").delete().eq("user_id", user_id).eq("job_id", job_id).execute()
    seed_live_match.cleanup(db, user_id)


def visible_text(page: Page, text: str) -> str:
    locator = page.get_by_text(text)
    try:
        return text if locator.count() and locator.first.is_visible(timeout=1000) else ""
    except Exception:
        return ""


def response_path(url: str) -> str:
    return urlparse(url).path


def is_hunter_api_url(url: str) -> bool:
    parsed = urlparse(url)
    if not parsed.path.startswith("/api/"):
        return False
    return parsed.hostname in {"127.0.0.1", "localhost"} and parsed.port == 8000


def write_report(report: RunReport) -> None:
    payload = {
        "steps": report.steps,
        "warnings": report.warnings,
        "api_calls": [
            {
                "method": call.method,
                "path": call.path,
                "status": call.status,
            }
            for call in report.api_calls
        ],
    }
    path = ARTIFACT_DIR / "report.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[INFO] Wrote report to {path}")


def print_recent_api_calls(report: RunReport) -> None:
    if not report.api_calls:
        print("[INFO] No Hunter API calls were captured.")
        return
    print("[INFO] Recent Hunter API calls:")
    for call in report.api_calls[-12:]:
        print(f"       {call.method} {call.path} status={call.status}")


if __name__ == "__main__":
    raise SystemExit(main())
