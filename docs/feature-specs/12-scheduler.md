# Feature Spec 12 — Daily Job Fetch Scheduler

## What This Is

The APScheduler job that runs automatically every day at 8am IST. For every user who has connected portals, it searches all their connected portals, stores job snapshots, scores the results with AI, deduplicates against already-seen jobs, and saves the matches above 60 to the database. Users wake up to a fresh, scored list in their Dashboard. No manual trigger required.

This is not the top-bar search feature. User-triggered searching belongs to `17-manual-job-search.md` and `POST /api/jobs/search`. The scheduler and manual search should share discovery/scoring/upsert helpers, but their UX and trigger semantics are different:

- Scheduler: background, preference-driven, runs at 8am IST, no user waiting on it.
- Manual search: foreground, query-driven, starts when the user clicks Search or presses Enter.

This scheduler fetches and scores only. It must not submit applications by itself. Auto-apply should run through a separate mode-aware apply runner that reads approved matches and user apply settings, then uses SafeApplyManager throttling.

## Prerequisites

- All portal specs (03–09) complete — at least Naukri
- `10-ai-layer.md` complete
- `11-safe-apply-manager.md` complete
- `01-database-schema.md` complete
- `backend/main.py` exists

---

## Implementation Steps

Before editing scheduler internals, extract shared discovery logic into a service that can be reused by `POST /api/jobs/search`:

```text
backend/services/job_discovery.py
  load_user_search_context(user_id)
  search_portals(...)
  score_and_save_matches(...)
```

The scheduler should pass `source='scheduler'`. Manual search should pass `source='manual'`.

### Step 1 — `backend/scheduler/daily_fetch.py`

```python
import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from core.database import get_db

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")


async def daily_job_fetch():
    """
    Main scheduled task. Runs at 8am IST daily.
    For each active user:
      1. Load their resume + preferences
      2. Search all connected portals
      3. Score each job with AI
      4. Save matches with score >= 60 to job_matches
    """
    logger.info(f"[Scheduler] Daily fetch started at {datetime.now(IST).strftime('%Y-%m-%d %H:%M:%S')} IST")
    db = get_db()

    # Get all users who have at least one portal connected
    users = _get_active_users(db)
    logger.info(f"[Scheduler] Found {len(users)} active users")

    for user in users:
        try:
            await _process_user(db, user)
        except Exception as e:
            logger.error(f"[Scheduler] Error processing user {user['id']}: {e}")
            # Continue with next user — one failure should not block others

    logger.info("[Scheduler] Daily fetch complete")


def _get_active_users(db) -> list:
    """Get users with at least one connected portal."""
    result = db.table("portal_tokens").select(
        "user_id"
    ).execute()

    # Also include users with company accounts
    company_result = db.table("company_accounts").select(
        "user_id"
    ).eq("account_status", "active").execute()

    user_ids = set()
    for row in (result.data or []):
        user_ids.add(row["user_id"])
    for row in (company_result.data or []):
        user_ids.add(row["user_id"])

    # Load full profile for each unique user
    users = []
    for uid in user_ids:
        profile = db.table("profiles").select("*").eq("id", uid).maybe_single().execute()
        if profile.data:
            users.append(profile.data)
    return users


async def _process_user(db, user: dict):
    user_id = user["id"]
    logger.info(f"[Scheduler] Processing user: {user_id}")

    # 1. Load preferences
    prefs_result = db.table("preferences").select("*").eq("user_id", user_id).maybe_single().execute()
    if not prefs_result.data:
        logger.info(f"[Scheduler] User {user_id} has no preferences set — skipping")
        return
    prefs = prefs_result.data

    # 2. Load resume
    resume_result = db.table("resumes").select("parsed_data, raw_text").eq(
        "user_id", user_id
    ).order("created_at", desc=True).limit(1).maybe_single().execute()
    if not resume_result.data or not resume_result.data.get("parsed_data"):
        logger.info(f"[Scheduler] User {user_id} has no parsed resume — skipping")
        return
    resume = resume_result.data["parsed_data"]

    # 3. Fetch jobs from all connected portals
    all_jobs = await _fetch_all_portals(db, user_id, prefs)
    logger.info(f"[Scheduler] User {user_id}: fetched {len(all_jobs)} total jobs across all portals")

    if not all_jobs:
        return

    # 4. Deduplicate — skip jobs already seen by this user
    existing_job_ids = _get_existing_job_ids(db, user_id)
    new_jobs = [j for j in all_jobs if _job_key(j) not in existing_job_ids]
    logger.info(f"[Scheduler] User {user_id}: {len(new_jobs)} new jobs after deduplication")

    # 5. Score and save
    from ai.job_scorer import score_job
    saved_count = 0
    for job in new_jobs:
        try:
            job_dict = _job_to_dict(job)

            # Save job to jobs table (ignore conflict on portal+job_id)
            db_job_id = _upsert_job(db, job_dict)
            if not db_job_id:
                continue

            # Score against this user's resume
            score_result = await score_job(resume, job_dict)

            # Only save matches above threshold
            if score_result["score"] >= 60:
                db.table("job_matches").upsert({
                    "user_id": user_id,
                    "job_id": db_job_id,
                    "match_score": score_result["score"],
                    "match_reasons": score_result.get("reasons", []),
                    "matched_skills": score_result.get("matched_skills", []),
                    "missing_skills": score_result.get("missing_skills", []),
                    "status": "pending",
                }, on_conflict="user_id,job_id").execute()
                saved_count += 1

        except Exception as e:
            logger.warning(f"[Scheduler] Error scoring job {_job_key(job)}: {e}")
            continue

    logger.info(f"[Scheduler] User {user_id}: saved {saved_count} matches with score >= 60")


async def _fetch_all_portals(db, user_id: str, prefs: dict) -> list:
    """Fetch jobs from all portals the user has connected."""
    jobs = []
    keywords = prefs.get("job_titles", ["Software Developer"])
    locations = prefs.get("locations", ["Bangalore"])
    experience = prefs.get("experience_years", 0)

    # Get connected portals
    tokens_result = db.table("portal_tokens").select("*").eq("user_id", user_id).execute()
    tokens = {row["portal"]: row for row in (tokens_result.data or [])}

    # Primary keyword/location combo
    keyword = keywords[0] if keywords else "Software Developer"
    location = locations[0] if locations else "Bangalore"

    # Naukri
    if "naukri" in tokens and tokens["naukri"].get("bearer_token"):
        try:
            from portals.naukri.auth import NaukriAuthClient
            from portals.naukri.jobs import NaukriJobClient
            auth = NaukriAuthClient()
            auth.bearer_token = tokens["naukri"]["bearer_token"]
            auth.profile_id = tokens["naukri"]["profile_id"]
            auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
            jc = NaukriJobClient(auth)
            reco = jc.get_recommended_jobs()
            searched = await jc.search_jobs(keyword=keyword, location=location, experience=experience)
            jobs.extend(reco + searched)
            logger.info(f"[Naukri] {len(reco)} recommended + {len(searched)} searched")
        except Exception as e:
            logger.error(f"[Scheduler] Naukri fetch failed: {e}")

    # Foundit
    if "foundit" in tokens and tokens["foundit"].get("bearer_token"):
        try:
            from portals.foundit.auth import FounditAuthClient
            from portals.foundit.jobs import FounditJobClient
            auth = FounditAuthClient()
            auth.bearer_token = tokens["foundit"]["bearer_token"]
            auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
            jc = FounditJobClient(auth)
            found = jc.search_jobs(keyword=keyword, location=location, experience=experience)
            jobs.extend(found)
            logger.info(f"[Foundit] {len(found)} jobs")
        except Exception as e:
            logger.error(f"[Scheduler] Foundit fetch failed: {e}")

    # LinkedIn (Playwright — slower, run last)
    if "linkedin" in tokens:
        try:
            from portals.linkedin.jobs import search_linkedin_jobs
            linkedin_jobs = await search_linkedin_jobs(keyword=keyword, location=location, max_jobs=25)
            jobs.extend(linkedin_jobs)
            logger.info(f"[LinkedIn] {len(linkedin_jobs)} jobs")
        except Exception as e:
            logger.error(f"[Scheduler] LinkedIn fetch failed: {e}")

    return jobs


def _job_key(job) -> str:
    return f"{job.portal}:{job.job_id}"


def _get_existing_job_ids(db, user_id: str) -> set:
    """Get set of 'portal:job_id' strings already matched to this user."""
    result = db.table("job_matches").select(
        "job_id"
    ).eq("user_id", user_id).execute()
    if not result.data:
        return set()
    job_ids = [row["job_id"] for row in result.data]
    if not job_ids:
        return set()
    jobs_result = db.table("jobs").select("id, portal, job_id").in_("id", job_ids).execute()
    return {f"{r['portal']}:{r['job_id']}" for r in (jobs_result.data or [])}


def _job_to_dict(job) -> dict:
    return {
        "portal": job.portal,
        "job_id": job.job_id,
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "description": job.description,
        "salary": job.salary,
        "experience": job.experience,
        "tags": job.tags,
        "apply_link": job.apply_link,
        "posted_date": job.posted_date,
        "is_workday": getattr(job, "is_workday", False),
        "is_taleo": getattr(job, "is_taleo", False),
        "has_questionnaire": getattr(job, "has_questionnaire", False),
    }


def _upsert_job(db, job_dict: dict) -> str | None:
    """Insert job if not exists; return the DB uuid."""
    try:
        result = db.table("jobs").upsert(
            job_dict, on_conflict="portal,job_id"
        ).execute()
        if result.data:
            return result.data[0]["id"]
    except Exception as e:
        logger.error(f"Failed to upsert job {job_dict.get('portal')}:{job_dict.get('job_id')}: {e}")
    return None
```

---

### Step 2 — Wire Into `backend/main.py`

```python
# Add to backend/main.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from scheduler.daily_fetch import daily_job_fetch

scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

@app.on_event("startup")
async def startup():
    scheduler.add_job(
        daily_job_fetch,
        trigger="cron",
        hour=8,
        minute=0,
        timezone="Asia/Kolkata",
        id="daily_job_fetch",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started — daily fetch at 8:00am IST")

@app.on_event("shutdown")
async def shutdown():
    scheduler.shutdown()

# Manual trigger endpoint (for testing and admin use)
from fastapi import Depends, HTTPException
from core.auth import get_current_user_id
from core.database import get_db

@app.post("/api/admin/trigger-fetch")
async def trigger_fetch(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    profile = db.table("profiles").select("is_admin").eq("id", user_id).maybe_single().execute()
    if not profile.data or not profile.data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    asyncio.create_task(daily_job_fetch())
    return {"message": "Fetch triggered in background"}
```

---

### Step 3 — Test Script

```python
# backend/test_scheduler.py
import asyncio
from scheduler.daily_fetch import daily_job_fetch, _get_active_users, _job_key
from core.database import get_db
from dotenv import load_dotenv

load_dotenv()

async def main():
    print("=== Scheduler Test ===")
    db = get_db()

    # 1. Get active users
    users = _get_active_users(db)
    print(f"[INFO] Active users with connected portals: {len(users)}")
    for u in users:
        print(f"       User: {u.get('email')}")

    if not users:
        print("[WARN] No active users found. Connect at least one portal before testing.")
        return

    # 2. Run the full fetch for all users
    print("\n[INFO] Running daily_job_fetch()...")
    await daily_job_fetch()
    print("[PASS] daily_job_fetch() completed without exception")

    # 3. Check that job_matches were written
    for user in users:
        result = db.table("job_matches").select(
            "match_score, status"
        ).eq("user_id", user["id"]).order("match_score", desc=True).limit(5).execute()
        count = len(result.data or [])
        print(f"[INFO] User {user.get('email')}: {count} matches with score >= 60")
        if count > 0:
            print(f"       Top scores: {[r['match_score'] for r in result.data]}")
            print(f"[PASS] Job matches saved correctly")

    print("\n=== Scheduler test complete ===")

asyncio.run(main())
```

Trigger manually via the API:
```bash
curl -X POST http://localhost:8000/api/admin/trigger-fetch \
  -H "Authorization: Bearer <admin_jwt>"
```

---

## Expected Success Behaviour

- Server starts with `"Scheduler started — daily fetch at 8:00am IST"` in logs
- Manual trigger returns `{"message": "Fetch triggered in background"}` only for an authenticated admin user
- After fetch completes: `job_matches` table contains rows for active users with `match_score >= 60`
- Jobs already scored for a user are not re-scored (deduplication works)
- If one portal fails (e.g. Naukri token expired), other portals continue and the error is logged

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| Scheduler doesn't fire at 8am | APScheduler not started, or app restarted | Check `startup()` hook runs; confirm `scheduler.start()` is called |
| `0 active users` found | No portal tokens in DB | User must connect at least one portal; check `portal_tokens` table |
| `0 matches saved` despite jobs fetched | All scores below 60 OR scorer failing | Check scorer output; lower threshold temporarily to 40 to debug |
| Same jobs scored every day | Deduplication not working | Check `_get_existing_job_ids` returns correct set; log its size |
| `RuntimeError: There is no current event loop` | APScheduler calling async function incorrectly | Use `asyncio.create_task()` inside the scheduler callback wrapper |
| LinkedIn fetch hangs | Playwright browser not closing | Add `asyncio.wait_for(search_linkedin_jobs(...), timeout=120)` |

## Challenges

- **Do not use scheduler as manual search**: The admin trigger runs the entire daily fetch and should stay admin/testing-only. Normal users should use `POST /api/jobs/search`, which accepts their explicit query and returns a search summary.

- **APScheduler + asyncio**: APScheduler's AsyncIOScheduler runs async jobs correctly, but the scheduler must be started with the running event loop. Always start it in the FastAPI `startup` event handler — not at module level.
- **LinkedIn Playwright in scheduler**: Playwright launches a real browser during the scheduled fetch. This adds 15–30 seconds to the fetch time and uses ~200MB RAM. If this is a problem, move LinkedIn to a separate scheduler job that runs at a different time.
- **Token expiry detection**: If a Naukri/Foundit token returns 401, the scheduler should write a notification to the DB (`portal_tokens.expires_at = now()`) so the frontend can show "Naukri token expired — please reconnect." This prevents silent failures.
- **Fetch time per user**: Searching 3–4 portals per user takes 30–90 seconds. With 10+ users, the daily fetch could run for 15+ minutes. At that scale, process users concurrently with `asyncio.gather()` (add a concurrency limiter to avoid overwhelming portals).
- **Score caching**: If the same job appears across multiple portals (e.g. a job posted on both Naukri and LinkedIn), the deduplication above only deduplicates per `portal:job_id`, not by job content. For MVP this is fine — the user just sees two similar entries.
