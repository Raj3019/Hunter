"""
Live MVP API smoke check.

Run this after the backend is already running.

Required env:
  HUNTER_TEST_EMAIL
  HUNTER_TEST_PASSWORD

Optional env:
  HUNTER_API_URL=http://127.0.0.1:8000
  HUNTER_TEST_RESUME=C:\\path\\to\\resume.pdf
  HUNTER_WRITE_PREFS=1
  HUNTER_REGISTER_IF_MISSING=0
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import requests


API_URL = os.getenv("HUNTER_API_URL", "http://127.0.0.1:8000").rstrip("/")
EMAIL = os.getenv("HUNTER_TEST_EMAIL", "")
PASSWORD = os.getenv("HUNTER_TEST_PASSWORD", "")
RESUME_PATH = os.getenv("HUNTER_TEST_RESUME", "")
WRITE_PREFS = os.getenv("HUNTER_WRITE_PREFS", "1") == "1"
REGISTER_IF_MISSING = os.getenv("HUNTER_REGISTER_IF_MISSING", "0") == "1"


def main() -> int:
    if not EMAIL or not PASSWORD:
        print("[FAIL] Set HUNTER_TEST_EMAIL and HUNTER_TEST_PASSWORD first.")
        return 2

    print(f"[INFO] Checking Hunter API at {API_URL}")
    check_health()
    token = login()
    headers = {"Authorization": f"Bearer {token}"}

    if WRITE_PREFS:
        save_preferences(headers)
    get_preferences(headers)
    upload_resume_if_configured(headers)
    get_resume(headers)
    get_portals(headers)
    get_matches(headers)
    get_applications(headers)

    print("\n=== Live MVP API smoke check complete ===")
    return 0


def check_health() -> None:
    response = requests.get(f"{API_URL}/health", timeout=15)
    response.raise_for_status()
    print("[PASS] /health")


def login() -> str:
    response = requests.post(
        f"{API_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    if response.status_code == 401 and REGISTER_IF_MISSING:
        print("[INFO] Login failed; attempting registration because HUNTER_REGISTER_IF_MISSING=1")
        register()
        response = requests.post(
            f"{API_URL}/api/auth/login",
            json={"email": EMAIL, "password": PASSWORD},
            timeout=30,
        )

    if response.status_code >= 400:
        print(f"[FAIL] Login failed: {safe_error(response)}")
        raise SystemExit(1)

    token = response.json().get("access_token")
    if not token:
        print("[FAIL] Login response did not include access_token. Confirm email verification settings.")
        raise SystemExit(1)

    print("[PASS] /api/auth/login returned a JWT")
    return token


def register() -> None:
    response = requests.post(
        f"{API_URL}/api/auth/register",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=30,
    )
    if response.status_code >= 400:
        print(f"[FAIL] Registration failed: {safe_error(response)}")
        raise SystemExit(1)
    print("[PASS] /api/auth/register")


def save_preferences(headers: dict[str, str]) -> None:
    payload = {
        "skills": ["React", "TypeScript", "Python", "FastAPI"],
        "job_titles": ["Frontend Engineer", "React Developer"],
        "locations": ["Bengaluru", "Remote India"],
        "work_type": ["remote", "hybrid"],
        "min_salary": 1200000,
        "max_salary": 2800000,
        "experience_years": 3,
        "avoid_companies": [],
        "apply_mode": "manual",
        "auto_apply_enabled": False,
        "auto_apply_daily_limit": 10,
        "auto_apply_min_score": 75,
        "auto_apply_allowed_portals": ["naukri", "foundit", "internshala"],
        "safe_apply_start_time": "09:00",
        "safe_apply_end_time": "20:00",
        "require_tailored_resume_approval": True,
    }
    response = requests.post(
        f"{API_URL}/api/preferences",
        json=payload,
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    print("[PASS] POST /api/preferences")


def get_preferences(headers: dict[str, str]) -> None:
    response = requests.get(f"{API_URL}/api/preferences", headers=headers, timeout=30)
    response.raise_for_status()
    print("[PASS] GET /api/preferences")


def upload_resume_if_configured(headers: dict[str, str]) -> None:
    if not RESUME_PATH:
        print("[SKIP] Set HUNTER_TEST_RESUME to upload and parse a PDF.")
        return

    path = Path(RESUME_PATH)
    if not path.exists():
        print(f"[SKIP] HUNTER_TEST_RESUME does not exist: {path}")
        return

    with path.open("rb") as resume_file:
        response = requests.post(
            f"{API_URL}/api/resume/upload",
            files={"file": (path.name, resume_file, "application/pdf")},
            headers=headers,
            timeout=180,
        )
    response.raise_for_status()
    parsed = response.json().get("parsed") or {}
    print(f"[PASS] POST /api/resume/upload parsed keys: {', '.join(list(parsed)[:6]) or 'none'}")


def get_resume(headers: dict[str, str]) -> None:
    response = requests.get(f"{API_URL}/api/resume/parsed", headers=headers, timeout=30)
    if response.status_code == 404:
        print("[SKIP] GET /api/resume/parsed returned 404 because no resume is uploaded yet.")
        return
    response.raise_for_status()
    print("[PASS] GET /api/resume/parsed")


def get_portals(headers: dict[str, str]) -> None:
    response = requests.get(f"{API_URL}/api/portals/status", headers=headers, timeout=30)
    response.raise_for_status()
    portals = response.json().get("portals") or {}
    accounts = response.json().get("company_accounts") or []
    print(f"[PASS] GET /api/portals/status portals={len(portals)} company_accounts={len(accounts)}")


def get_matches(headers: dict[str, str]) -> None:
    response = requests.get(f"{API_URL}/api/jobs/matches", headers=headers, timeout=30)
    response.raise_for_status()
    matches = response.json().get("matches") or []
    print(f"[PASS] GET /api/jobs/matches count={len(matches)}")


def get_applications(headers: dict[str, str]) -> None:
    response = requests.get(f"{API_URL}/api/applications", headers=headers, timeout=30)
    response.raise_for_status()
    applications = response.json().get("applications") or []
    print(f"[PASS] GET /api/applications count={len(applications)}")


def safe_error(response: requests.Response) -> str:
    try:
        detail = response.json().get("detail")
        if detail:
            return str(detail)
    except ValueError:
        pass
    return f"HTTP {response.status_code}"


if __name__ == "__main__":
    sys.exit(main())
