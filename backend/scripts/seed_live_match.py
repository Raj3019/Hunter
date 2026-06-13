"""
Seed one real DB-backed job match for frontend/API verification.

This does not apply to any job. It creates a clearly marked job snapshot
and a pending job_match for a test user so /api/jobs/matches has data.

Set one of:
  HUNTER_TEST_USER_ID=<profile uuid>
  HUNTER_TEST_EMAIL=<profile email>

Optional:
  HUNTER_SEED_CLEANUP=1  delete this seeded match instead of creating it
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import get_db  # noqa: E402


SEED_PORTAL = "foundit"
SEED_JOB_ID = "hunter-seed-frontend-engineer-001"


def main() -> int:
    db = get_db()
    user_id = resolve_user_id(db)
    if not user_id:
        print("[FAIL] Set HUNTER_TEST_USER_ID or HUNTER_TEST_EMAIL for an existing profile.")
        return 2

    if os.getenv("HUNTER_SEED_CLEANUP") == "1":
        cleanup(db, user_id)
        return 0

    job_id = upsert_seed_job(db)
    upsert_seed_match(db, user_id, job_id)
    print("[PASS] Seeded one pending match.")
    print(f"       user_id={user_id}")
    print(f"       portal={SEED_PORTAL}")
    print(f"       portal_job_id={SEED_JOB_ID}")
    print("       Open /jobs after signing in to review it.")
    return 0


def resolve_user_id(db) -> str:
    user_id = os.getenv("HUNTER_TEST_USER_ID", "").strip()
    if user_id:
        return user_id

    email = os.getenv("HUNTER_TEST_EMAIL", "").strip()
    if not email:
        return ""

    result = db.table("profiles").select("id").eq("email", email).maybe_single().execute()
    return (result.data or {}).get("id", "")


def upsert_seed_job(db) -> str:
    payload = {
        "portal": SEED_PORTAL,
        "job_id": SEED_JOB_ID,
        "title": "Frontend Engineer - Hunter Seed",
        "company": "Hunter Verification",
        "location": "Bengaluru / Remote India",
        "description": (
            "Seed job for validating the Hunter live MVP flow. Requires React, TypeScript, "
            "API integration, dashboard UX, and careful production debugging."
        ),
        "salary": "Not disclosed",
        "experience": "3-5 years",
        "tags": ["React", "TypeScript", "FastAPI", "Dashboard"],
        "apply_link": "https://example.com/hunter-seed-job",
        "posted_date": "seed",
        "is_workday": False,
        "is_taleo": False,
        "has_questionnaire": False,
        "source_status": "active",
    }
    created = db.table("jobs").upsert(payload, on_conflict="portal,job_id").execute()
    if created.data:
        return created.data[0]["id"]

    existing = db.table("jobs").select("id").eq("portal", SEED_PORTAL).eq(
        "job_id",
        SEED_JOB_ID,
    ).maybe_single().execute()
    job_id = (existing.data or {}).get("id")
    if not job_id:
        raise RuntimeError("Could not create or find seed job")
    return job_id


def upsert_seed_match(db, user_id: str, job_id: str) -> None:
    payload = {
        "user_id": user_id,
        "job_id": job_id,
        "match_score": 88,
        "match_reasons": [
            "Strong React and TypeScript match",
            "Dashboard and API integration experience aligns",
        ],
        "matched_skills": ["React", "TypeScript", "FastAPI", "Playwright"],
        "missing_skills": ["Production apply verification"],
        "status": "pending",
    }
    db.table("job_matches").upsert(payload, on_conflict="user_id,job_id").execute()


def cleanup(db, user_id: str) -> None:
    existing = db.table("jobs").select("id").eq("portal", SEED_PORTAL).eq(
        "job_id",
        SEED_JOB_ID,
    ).maybe_single().execute()
    job_id = (existing.data or {}).get("id")
    if not job_id:
        print("[PASS] Seed job is already absent.")
        return

    db.table("job_matches").delete().eq("user_id", user_id).eq("job_id", job_id).execute()
    print("[PASS] Removed seeded job_match for test user.")


if __name__ == "__main__":
    sys.exit(main())
