"""
Fresh-user Playwright E2E for Hunter onboarding.

Default mode creates a disposable confirmed Supabase auth user with the service
role key, signs in through the real UI, uploads a synthetic text PDF resume,
saves profile preferences, verifies API state, and opens the Jobs screen.

Optional env:
  HUNTER_FRESH_E2E_BASE_URL=http://127.0.0.1:3000
  HUNTER_FRESH_E2E_API_URL=http://127.0.0.1:8000
  HUNTER_FRESH_E2E_HEADLESS=0
  HUNTER_FRESH_E2E_AUTH_MODE=admin  # admin | register
  HUNTER_FRESH_E2E_EMAIL=<email>
  HUNTER_FRESH_E2E_PASSWORD=<password>
  HUNTER_FRESH_E2E_KEEP_USER=0
  HUNTER_FRESH_E2E_RUN_PROFILE_SEARCH=0
  HUNTER_FRESH_E2E_START_NAUKRI_CONNECT=0

The test never submits a portal application.
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, expect, sync_playwright


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
ARTIFACT_DIR = BACKEND_ROOT / "test-artifacts" / "fresh-onboarding"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

if os.getenv("HUNTER_FRESH_E2E_USE_PROJECT_BROWSERS") == "1":
    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(BACKEND_ROOT / ".playwright-browsers"))

BASE_URL = os.getenv("HUNTER_FRESH_E2E_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
API_URL = os.getenv("HUNTER_FRESH_E2E_API_URL", "http://127.0.0.1:8000").rstrip("/")
HEADLESS = os.getenv("HUNTER_FRESH_E2E_HEADLESS", "0") == "1"
AUTH_MODE = os.getenv("HUNTER_FRESH_E2E_AUTH_MODE", "admin").strip().lower()
KEEP_USER = os.getenv("HUNTER_FRESH_E2E_KEEP_USER", "0") == "1"
RUN_PROFILE_SEARCH = os.getenv("HUNTER_FRESH_E2E_RUN_PROFILE_SEARCH", "0") == "1"
START_NAUKRI_CONNECT = os.getenv("HUNTER_FRESH_E2E_START_NAUKRI_CONNECT", "0") == "1"


@dataclass
class TestUser:
    email: str
    password: str
    user_id: str = ""
    created_by_admin: bool = False


@dataclass
class RunReport:
    steps: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    api_calls: list[dict[str, Any]] = field(default_factory=list)
    user_email: str = ""
    user_id: str = ""

    def step(self, message: str) -> None:
        self.steps.append(message)
        print(f"[PASS] {message}")

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"[WARN] {message}")


def main() -> int:
    if AUTH_MODE not in {"admin", "register"}:
        print("[FAIL] HUNTER_FRESH_E2E_AUTH_MODE must be admin or register.")
        return 2

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    wait_for_servers()
    resume_path = create_resume_fixture()
    report = RunReport()
    user = make_test_user()
    report.user_email = user.email

    try:
        if AUTH_MODE == "admin":
            create_confirmed_user(user)
            report.user_id = user.user_id
            report.step("Created a confirmed disposable Hunter user")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS, slow_mo=120 if not HEADLESS else 0)
            context = browser.new_context(viewport={"width": 1440, "height": 920})
            page = context.new_page()
            wire_api_recording(page, report)
            try:
                if AUTH_MODE == "register":
                    register_through_ui(page, user, report)
                else:
                    login_through_ui(page, user, report)
                if not report.user_id:
                    report.user_id = resolve_user_id(user.email) or ""

                complete_onboarding(page, resume_path, report)
                verify_saved_state(page, report)
                verify_jobs_screen(page, report)
                if START_NAUKRI_CONNECT:
                    verify_naukri_connect_starts(page, report)

                page.screenshot(path=str(ARTIFACT_DIR / "final.png"), full_page=True)
                report.step(f"Saved final screenshot to {ARTIFACT_DIR / 'final.png'}")
            except Exception:
                page.screenshot(path=str(ARTIFACT_DIR / "failure.png"), full_page=True)
                print(f"[INFO] Saved failure screenshot to {ARTIFACT_DIR / 'failure.png'}")
                write_report(report)
                raise
            finally:
                browser.close()
    finally:
        if user.created_by_admin and user.user_id and not KEEP_USER:
            cleanup_test_user(user, report)

    write_report(report)
    print("[PASS] Fresh onboarding E2E completed")
    return 0


def wait_for_servers() -> None:
    for label, url in [("backend", f"{API_URL}/health"), ("frontend", BASE_URL)]:
        for _ in range(40):
            try:
                response = requests.get(url, timeout=5)
                if response.status_code < 500:
                    print(f"[INFO] {label} is reachable")
                    break
            except requests.RequestException:
                time.sleep(1)
        else:
            raise RuntimeError(f"{label} is not reachable at {url}")


def make_test_user() -> TestUser:
    email = os.getenv("HUNTER_FRESH_E2E_EMAIL", "").strip()
    password = os.getenv("HUNTER_FRESH_E2E_PASSWORD", "").strip()
    if not email:
        email = f"hunter.e2e.{int(time.time())}.{secrets.token_hex(3)}@example.com"
    if not password:
        password = f"HunterFresh{secrets.token_hex(6)}!30"
    return TestUser(email=email, password=password)


def create_confirmed_user(user: TestUser) -> None:
    from core.database import get_db, get_service_client

    client = get_service_client()
    response = client.auth.admin.create_user({
        "email": user.email,
        "password": user.password,
        "email_confirm": True,
    })
    created = getattr(response, "user", None)
    user.user_id = str(getattr(created, "id", "") or "")
    if not user.user_id:
        raise RuntimeError("Supabase admin create_user did not return a user id.")
    user.created_by_admin = True

    db = get_db()
    existing = db.table("profiles").select("id").eq("id", user.user_id).maybe_single().execute()
    if not existing.data:
        db.table("profiles").upsert({"id": user.user_id, "email": user.email}, on_conflict="id").execute()


def create_resume_fixture() -> Path:
    from fpdf import FPDF

    path = ARTIFACT_DIR / "fresh-onboarding-resume.pdf"
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=12)
    lines = [
        "Aarav Fresh",
        "aarav.fresh@example.com | +91 90000 00000 | Bengaluru",
        "Frontend Engineer with 3 years of experience building React and TypeScript applications.",
        "Skills: React, TypeScript, JavaScript, Python, FastAPI, PostgreSQL, Git, Tailwind CSS, REST API.",
        "Experience: Frontend Engineer at DemoCloud from 2022 to 2026.",
        "Built reusable UI systems, integrated REST APIs, and collaborated with backend teams.",
        "Education: B.Tech Computer Science, Demo Institute, 2021.",
    ]
    y = 16
    for line in lines:
        pdf.text(12, y, line[:120])
        y += 8
    pdf.output(str(path))
    return path


def wire_api_recording(page: Page, report: RunReport) -> None:
    def on_response(response: Any) -> None:
        parsed = urlparse(response.url)
        if parsed.hostname in {"127.0.0.1", "localhost"} and parsed.path.startswith("/api/"):
            report.api_calls.append({
                "method": response.request.method,
                "path": parsed.path,
                "status": response.status,
            })

    page.on("response", on_response)


def login_through_ui(page: Page, user: TestUser, report: RunReport) -> None:
    page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
    expect(page.get_by_role("heading", name="Sign in")).to_be_visible(timeout=20000)
    page.get_by_label("Email").fill(user.email)
    page.get_by_label("Password").fill(user.password)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_url("**/onboarding", timeout=45000)
    expect(page.get_by_role("heading", name="Resume & Preferences")).to_be_visible(timeout=20000)
    report.step("Fresh user signed in and was routed to onboarding")


def register_through_ui(page: Page, user: TestUser, report: RunReport) -> None:
    page.goto(f"{BASE_URL}/auth", wait_until="domcontentloaded")
    page.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("heading", name="Create account")).to_be_visible(timeout=15000)
    page.get_by_label("Email").fill(user.email)
    page.get_by_label("Password").fill(user.password)
    page.get_by_role("button", name="Continue").click()
    try:
        page.wait_for_url("**/onboarding", timeout=45000)
    except PlaywrightTimeoutError as exc:
        if page.get_by_text("Check your email").count():
            raise RuntimeError("Public registration requires email confirmation before first login.") from exc
        raise
    report.step("Fresh user registered through the UI and was routed to onboarding")


def complete_onboarding(page: Page, resume_path: Path, report: RunReport) -> None:
    with page.expect_response(lambda response: response_path(response.url) == "/api/resume/upload", timeout=180000) as response_info:
        page.locator("input[type='file']").set_input_files(str(resume_path))
    response = response_info.value
    if response.status >= 400:
        raise RuntimeError(f"Resume upload failed with HTTP {response.status}: {response.text()[:500]}")
    expect(page.get_by_text("Parsed resume preview")).to_be_visible(timeout=30000)
    report.step("Uploaded and parsed a synthetic resume through onboarding")

    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", name="Job preferences")).to_be_visible(timeout=15000)
    page.get_by_label("Skills").fill("React, TypeScript, Python, FastAPI, PostgreSQL")
    page.get_by_label("Job titles").fill("Frontend Engineer, React Developer")
    page.get_by_label("Locations").fill("Bengaluru, Pune, Remote India")
    page.get_by_label("Work type").fill("Remote, Hybrid")
    page.get_by_label("Salary").fill("12-24 LPA")
    page.get_by_label("Experience years").fill("3")
    page.get_by_label("Avoid list").fill("Night shifts")
    report.step("Entered profile-first job preferences")

    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", name="Portal connections")).to_be_visible(timeout=15000)
    expect(page.get_by_role("button", name="Naukri Token based board")).to_be_visible(timeout=15000)
    report.step("Reviewed portal selection step without requiring portal credentials")

    page.get_by_role("button", name="Continue").click()
    expect(page.get_by_role("heading", name="Review setup")).to_be_visible(timeout=15000)
    with page.expect_response(lambda response: response_path(response.url) == "/api/preferences", timeout=45000) as response_info:
        page.get_by_role("button", name="Save setup").click()
    response = response_info.value
    if response.status >= 400:
        raise RuntimeError(f"Preference save failed with HTTP {response.status}: {response.text()[:500]}")
    page.wait_for_url("**/dashboard", timeout=30000)
    expect(page.get_by_role("heading", name="Today")).to_be_visible(timeout=20000)
    report.step("Saved onboarding setup and reached Dashboard")


def verify_saved_state(page: Page, report: RunReport) -> None:
    token = page.evaluate("window.localStorage.getItem('access_token')")
    if not token:
        raise RuntimeError("No access token found after onboarding.")
    headers = {"Authorization": f"Bearer {token}"}

    preferences = requests.get(f"{API_URL}/api/preferences", headers=headers, timeout=30)
    preferences.raise_for_status()
    data = preferences.json()
    if "React" not in data.get("skills", []) or "Frontend Engineer" not in data.get("job_titles", []):
        raise RuntimeError("Saved preferences did not include expected profile fields.")

    resume = requests.get(f"{API_URL}/api/resume/parsed", headers=headers, timeout=30)
    resume.raise_for_status()
    parsed = resume.json().get("parsed_data") or {}
    if not parsed.get("skills"):
        raise RuntimeError("Parsed resume did not contain extracted skills.")
    report.step("Verified saved preferences and parsed resume through backend APIs")


def verify_jobs_screen(page: Page, report: RunReport) -> None:
    page.get_by_role("link", name="Jobs").click()
    expect(page.get_by_role("heading", name="Job matches")).to_be_visible(timeout=20000)
    expect(page.get_by_text("Search live jobs", exact=True)).to_be_visible(timeout=15000)
    expect(page.get_by_role("button", name="Recommended")).to_be_visible(timeout=15000)
    expect(page.get_by_role("button", name="All results")).to_be_visible(timeout=15000)
    report.step("Jobs screen exposes recommended and all-results sections for the fresh user")

    if not RUN_PROFILE_SEARCH:
        report.warn("Skipped profile search because a fresh user has no Naukri session by default.")
        return

    with page.expect_response(lambda response: response_path(response.url) == "/api/jobs/search", timeout=210000) as response_info:
        page.get_by_role("button", name="Profile").click()
    response = response_info.value
    if response.status >= 400:
        raise RuntimeError(f"Profile search failed with HTTP {response.status}: {response.text()[:500]}")
    body = response.json()
    run = body.get("run") or {}
    if int(run.get("fetched_count") or 0) <= 0:
        raise RuntimeError("Profile search completed but fetched zero jobs.")
    report.step(f"Profile search completed: fetched={run.get('fetched_count')} saved={run.get('saved_matches_count')}")


def verify_naukri_connect_starts(page: Page, report: RunReport) -> None:
    page.get_by_role("link", name="Portals").click()
    expect(page.get_by_role("heading", name="Portal connections")).to_be_visible(timeout=20000)
    expect(page.get_by_text("Naukri").first).to_be_visible(timeout=10000)
    expect(page.get_by_text("Public search").first).to_be_visible(timeout=10000)
    expect(page.get_by_role("button", name="Browser login").first).to_be_visible(timeout=10000)
    report.step("Verified Naukri public search is shown with optional browser login in Portals")


def response_path(url: str) -> str:
    return urlparse(url).path


def resolve_user_id(email: str) -> str:
    from core.database import get_db

    result = get_db().table("profiles").select("id").eq("email", email).maybe_single().execute()
    return str((result.data or {}).get("id") or "")


def cleanup_test_user(user: TestUser, report: RunReport) -> None:
    from core.database import get_db, get_service_client

    db = get_db()
    for table in (
        "applications",
        "tailored_resumes",
        "job_matches",
        "resumes",
        "preferences",
        "portal_tokens",
        "company_accounts",
    ):
        try:
            db.table(table).delete().eq("user_id", user.user_id).execute()
        except Exception:
            report.warn(f"Cleanup skipped table {table}")
    try:
        db.storage.from_("resumes").remove([f"{user.user_id}/fresh-onboarding-resume.pdf"])
    except Exception:
        pass
    try:
        db.table("profiles").delete().eq("id", user.user_id).execute()
    except Exception:
        report.warn("Cleanup skipped profile row")
    try:
        get_service_client().auth.admin.delete_user(user.user_id)
        report.step("Cleaned up disposable Supabase auth user")
    except Exception:
        report.warn("Cleanup skipped Supabase auth user")


def write_report(report: RunReport) -> None:
    payload = {
        "user_email": report.user_email,
        "user_id": report.user_id,
        "steps": report.steps,
        "warnings": report.warnings,
        "api_calls": report.api_calls,
    }
    path = ARTIFACT_DIR / "report.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[INFO] Wrote report to {path}")


if __name__ == "__main__":
    raise SystemExit(main())
