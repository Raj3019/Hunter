"""
Remove only clearly-marked seed/test data:
  - the "Hunter Verification" seed job (foundit:hunter-seed-frontend-engineer-001)
    plus its job_matches / applications, and
  - leftover disposable e2e users (hunter.e2e.*@example.com) with all their rows and
    their Supabase auth user.

Registered user accounts are left completely untouched.

Run from backend/:
  python scripts/cleanup_test_data.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import get_db, get_service_client  # noqa: E402

SEED_PORTAL = "foundit"
SEED_JOB_ID = "hunter-seed-frontend-engineer-001"
E2E_EMAIL_PATTERN = "hunter.e2e.%@example.com"
USER_TABLES = (
    "applications",
    "tailored_resumes",
    "job_matches",
    "resumes",
    "preferences",
    "portal_tokens",
    "company_accounts",
)


def remove_seed_job(db) -> None:
    existing = db.table("jobs").select("id").eq("portal", SEED_PORTAL).eq(
        "job_id", SEED_JOB_ID
    ).maybe_single().execute()
    job_id = (existing.data or {}).get("id") if existing else None
    if not job_id:
        print("[skip] Seed job not present.")
        return
    for table in ("applications", "job_matches"):
        try:
            db.table(table).delete().eq("job_id", job_id).execute()
        except Exception as exc:
            print(f"[warn] {table} by job_id: {exc}")
    db.table("jobs").delete().eq("id", job_id).execute()
    print(f"[done] Removed seed job {SEED_PORTAL}:{SEED_JOB_ID} (+ its matches/applications).")


def remove_e2e_users(db) -> None:
    try:
        rows = (db.table("profiles").select("id, email").ilike("email", E2E_EMAIL_PATTERN).execute().data) or []
    except Exception as exc:
        print(f"[warn] Could not query e2e profiles: {exc}")
        rows = []
    if not rows:
        print("[skip] No hunter.e2e.*@example.com users found.")
        return

    try:
        service = get_service_client()
    except Exception:
        service = None
        print("[warn] No service client available; DB rows removed but auth users will remain.")

    for row in rows:
        uid = row.get("id")
        email = row.get("email")
        if not uid:
            continue
        for table in USER_TABLES:
            try:
                db.table(table).delete().eq("user_id", uid).execute()
            except Exception:
                pass
        try:
            db.table("profiles").delete().eq("id", uid).execute()
        except Exception:
            pass
        if service:
            try:
                service.auth.admin.delete_user(uid)
            except Exception:
                pass
        print(f"[done] Removed disposable e2e user {email}")


def main() -> int:
    db = get_db()
    print("Cleaning marked seed/test data (registered accounts are NOT touched)...")
    remove_seed_job(db)
    remove_e2e_users(db)
    print("[ok] Cleanup complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
