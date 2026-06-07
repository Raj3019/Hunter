"""
Naukri browser-session hardening check.

This script verifies the saved Naukri connection for a Hunter user without
printing bearer tokens. It can optionally replace only the DB bearer token with
a dummy value, check whether the app refreshes from the persistent browser
profile, then restore the original row.

Optional env:
  HUNTER_NAUKRI_CHECK_USER_ID=<profile id>
  HUNTER_NAUKRI_CHECK_EMAIL=<Hunter email>
  HUNTER_NAUKRI_CHECK_SIMULATE_EXPIRED_TOKEN=1
  HUNTER_NAUKRI_CHECK_REQUIRE_CONNECTED=0
  HUNTER_NAUKRI_CHECK_REQUIRE_PROFILE_REFRESH=0
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
ARTIFACT_DIR = BACKEND_ROOT / "test-artifacts" / "naukri-session"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(REPO_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

SIMULATE_EXPIRED_TOKEN = os.getenv("HUNTER_NAUKRI_CHECK_SIMULATE_EXPIRED_TOKEN", "0") == "1"
REQUIRE_CONNECTED = os.getenv("HUNTER_NAUKRI_CHECK_REQUIRE_CONNECTED", "0") == "1"
REQUIRE_PROFILE_REFRESH = os.getenv("HUNTER_NAUKRI_CHECK_REQUIRE_PROFILE_REFRESH", "0") == "1"


@dataclass
class RunReport:
    user_id: str = ""
    token_row_present: bool = False
    profile_path_present: bool = False
    profile_path_is_user_scoped: bool = False
    initial_status: dict[str, Any] = field(default_factory=dict)
    refresh_source: str = ""
    simulated_status: dict[str, Any] = field(default_factory=dict)
    restored: bool = False
    warnings: list[str] = field(default_factory=list)

    def warn(self, message: str) -> None:
        self.warnings.append(message)
        print(f"[WARN] {message}")


def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    report = RunReport()

    from api.routes.portals import _check_naukri_status
    from core.database import get_db
    from portals.naukri.connect import PROFILE_ROOT, refresh_naukri_auth

    db = get_db()
    user = resolve_user(db)
    if not user:
        print("[FAIL] No Hunter profile found. Set HUNTER_NAUKRI_CHECK_USER_ID or HUNTER_NAUKRI_CHECK_EMAIL.")
        return 2

    user_id = str(user.get("id") or "")
    report.user_id = user_id
    print("[INFO] Checking Naukri session for selected Hunter user")

    row = load_naukri_row(db, user_id)
    report.token_row_present = bool(row)
    if not row:
        report.warn("No Naukri token row exists. Use Portals > Naukri > Connect before running the refresh check.")
        write_report(report)
        return 1 if REQUIRE_CONNECTED else 0

    profile_path = str(row.get("chrome_profile_path") or "")
    report.profile_path_present = bool(profile_path)
    report.profile_path_is_user_scoped = _is_user_scoped_profile(profile_path, user_id, PROFILE_ROOT)
    if not report.profile_path_present:
        report.warn("Naukri row has no chrome_profile_path; reconnect is needed for browser-session durability.")
    elif not report.profile_path_is_user_scoped:
        report.warn("Naukri profile path is not user-scoped under backend/chrome_profiles/naukri/{user_id}.")

    auth = refresh_naukri_auth(user_id, row)
    report.refresh_source = "browser_profile" if getattr(auth, "token_refreshed_from_profile", False) else "stored_db_token"
    print(f"[INFO] Refresh source: {report.refresh_source}")

    status = _check_naukri_status(row, user_id)
    report.initial_status = _safe_status(status)
    print(f"[INFO] Initial status: {status.get('connection_status')} - {status.get('status_message')}")

    if REQUIRE_CONNECTED and status.get("requires_reconnect"):
        write_report(report)
        print("[FAIL] Naukri requires reconnect.")
        return 1

    if REQUIRE_PROFILE_REFRESH and report.refresh_source != "browser_profile":
        write_report(report)
        print("[FAIL] Naukri auth did not refresh from the browser profile.")
        return 1

    if SIMULATE_EXPIRED_TOKEN:
        simulate_expired_token(db, user_id, row, report, _check_naukri_status)

    write_report(report)
    print("[PASS] Naukri session check completed")
    return 0


def resolve_user(db) -> dict | None:
    user_id = os.getenv("HUNTER_NAUKRI_CHECK_USER_ID", "").strip()
    if user_id:
        result = db.table("profiles").select("*").eq("id", user_id).maybe_single().execute()
        return result.data

    email = os.getenv("HUNTER_NAUKRI_CHECK_EMAIL", "").strip()
    if email:
        result = db.table("profiles").select("*").eq("email", email).maybe_single().execute()
        return result.data

    token = db.table("portal_tokens").select("user_id").eq("portal", "naukri").limit(1).execute()
    token_user_id = ((token.data or [{}])[0]).get("user_id")
    if token_user_id:
        result = db.table("profiles").select("*").eq("id", token_user_id).maybe_single().execute()
        return result.data

    users = db.table("profiles").select("*").limit(1).execute()
    return (users.data or [None])[0]


def load_naukri_row(db, user_id: str) -> dict:
    result = db.table("portal_tokens").select("*").eq("user_id", user_id).eq("portal", "naukri").maybe_single().execute()
    return result.data or {}


def simulate_expired_token(db, user_id: str, original: dict, report: RunReport, status_checker) -> None:
    print("[INFO] Simulating expired DB bearer token")
    restore_payload = {
        "bearer_token": original.get("bearer_token"),
        "profile_id": original.get("profile_id"),
        "chrome_profile_path": original.get("chrome_profile_path"),
    }
    try:
        db.table("portal_tokens").update({"bearer_token": "codex-invalid-naukri-token"}).eq(
            "user_id",
            user_id,
        ).eq("portal", "naukri").execute()

        invalid_row = load_naukri_row(db, user_id)
        status = status_checker(invalid_row, user_id)
        report.simulated_status = _safe_status(status)
        print(f"[INFO] Simulated status: {status.get('connection_status')} - {status.get('status_message')}")
    finally:
        db.table("portal_tokens").update(restore_payload).eq("user_id", user_id).eq("portal", "naukri").execute()
        report.restored = True
        print("[INFO] Restored original Naukri token row")


def _is_user_scoped_profile(profile_path: str, user_id: str, profile_root: Path) -> bool:
    if not profile_path:
        return False
    try:
        path = Path(profile_path)
        if not path.is_absolute():
            path = (BACKEND_ROOT / profile_path).resolve()
        else:
            path = path.resolve()
        expected = (profile_root / user_id).resolve()
        return path == expected
    except Exception:
        return False


def _safe_status(status: dict) -> dict:
    return {
        "connection_status": status.get("connection_status"),
        "requires_reconnect": status.get("requires_reconnect"),
        "status_message": status.get("status_message"),
        "last_checked_at": status.get("last_checked_at"),
    }


def write_report(report: RunReport) -> None:
    path = ARTIFACT_DIR / "report.json"
    path.write_text(json.dumps(report.__dict__, indent=2), encoding="utf-8")
    print(f"[INFO] Wrote report to {path}")


if __name__ == "__main__":
    raise SystemExit(main())
