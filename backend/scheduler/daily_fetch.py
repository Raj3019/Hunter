import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from core.database import NULL_RESULT, get_db

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")
MATCH_THRESHOLD = 60


async def daily_job_fetch():
    """
    Main scheduled task. Runs at 8am IST daily.
    For each active user:
      1. Load their preferences + latest resume
      2. Search connected portals from saved preferences
      3. Score each fetched job against the resume with AI
      4. Save matches with score >= 60 to job_matches
    """
    logger.info(
        "[Scheduler] Daily fetch started at %s IST",
        datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S"),
    )
    db = get_db()

    users = _get_active_users(db)
    logger.info("[Scheduler] Found %s active users", len(users))

    for user in users:
        try:
            await _process_user(db, user)
        except Exception as exc:
            logger.error("[Scheduler] Error processing user %s: %s", user.get("id"), exc)

    logger.info("[Scheduler] Daily fetch complete")


def _get_active_users(db) -> list:
    """Get users with at least one connected portal or active company account."""
    portal_result = db.table("portal_tokens").select("user_id").execute()
    company_result = db.table("company_accounts").select("user_id").eq(
        "account_status",
        "active",
    ).execute()

    user_ids = set()
    for row in portal_result.data or []:
        if row.get("user_id"):
            user_ids.add(row["user_id"])
    for row in company_result.data or []:
        if row.get("user_id"):
            user_ids.add(row["user_id"])

    users = []
    for uid in user_ids:
        profile = db.table("profiles").select("*").eq("id", uid).maybe_single().execute() or NULL_RESULT
        if profile.data:
            users.append(profile.data)
    return users


async def _process_user(db, user: dict):
    user_id = user["id"]
    logger.info("[Scheduler] Processing user: %s", user_id)

    prefs_result = db.table("preferences").select("*").eq(
        "user_id",
        user_id,
    ).maybe_single().execute() or NULL_RESULT
    if not prefs_result.data:
        logger.info("[Scheduler] User %s has no preferences set - skipping", user_id)
        return
    prefs = prefs_result.data

    resume_result = db.table("resumes").select("parsed_data, raw_text").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    if not resume_result.data or not resume_result.data.get("parsed_data"):
        logger.info("[Scheduler] User %s has no parsed resume - skipping", user_id)
        return
    resume = resume_result.data["parsed_data"]

    all_jobs = await _fetch_all_portals(db, user_id, prefs)
    logger.info(
        "[Scheduler] User %s: fetched %s total jobs across all portals",
        user_id,
        len(all_jobs),
    )

    if not all_jobs:
        return

    from services.job_discovery import _filter_jobs_by_preferences, _scoring_context, score_and_save_matches

    existing_job_ids = _get_existing_job_ids(db, user_id)
    warnings: list[str] = []
    scheduler_request = _scheduler_request_from_preferences(prefs)
    preference_jobs = _filter_jobs_by_preferences(all_jobs, scheduler_request, warnings)
    new_jobs = [job for job in preference_jobs if _job_key(job) not in existing_job_ids]
    logger.info(
        "[Scheduler] User %s: %s preference-matched jobs, %s new after deduplication",
        user_id,
        len(preference_jobs),
        len(new_jobs),
    )
    saved_matches = await score_and_save_matches(
        db,
        user_id=user_id,
        resume=resume,
        jobs=new_jobs,
        min_score=MATCH_THRESHOLD,
        source="scheduler",
        search_run_id="",
        search_query=_primary_value(prefs.get("job_titles") or prefs.get("skills"), "Software Developer"),
        search_location=_primary_value(prefs.get("locations"), "Bangalore"),
        warnings=warnings,
        scoring_context=_scoring_context(scheduler_request, resume),
    )
    for warning in warnings:
        logger.warning("[Scheduler] %s", warning)

    logger.info(
        "[Scheduler] User %s: saved %s matches with score >= %s",
        user_id,
        len(saved_matches),
        MATCH_THRESHOLD,
    )


async def _fetch_all_portals(db, user_id: str, prefs: dict) -> list:
    """Fetch jobs from all portals the user has connected."""
    jobs = []
    keywords = prefs.get("job_titles") or prefs.get("skills") or ["Software Developer"]
    locations = prefs.get("locations") or ["Bangalore"]
    experience = prefs.get("experience_years", 0) or 0

    keyword = keywords[0] if keywords else "Software Developer"
    location = locations[0] if locations else "Bangalore"

    tokens_result = db.table("portal_tokens").select("*").eq("user_id", user_id).execute()
    tokens = {row["portal"]: row for row in (tokens_result.data or []) if row.get("portal")}

    try:
        from portals.naukri.auth import NaukriAuthClient
        from portals.naukri.jobs import NaukriJobClient
        from portals.naukri.session import get_valid_naukri_auth

        # Use the durable Naukri login when connected so the daily fetch can also
        # pull personalized recommendations; falls back to public keyword search.
        auth = await asyncio.to_thread(get_valid_naukri_auth, user_id, tokens.get("naukri"))
        authenticated = auth is not None
        jc = NaukriJobClient(auth or NaukriAuthClient())

        if authenticated:
            try:
                recommended = await asyncio.to_thread(jc.get_recommended_jobs)
                jobs.extend(recommended)
                logger.info("[Naukri] %s recommended (authenticated)", len(recommended))
            except Exception as exc:
                logger.info("[Scheduler] Naukri recommended unavailable: %s", exc)

        searched = await jc.search_jobs(
            keyword=keyword,
            location=location,
            experience=experience,
        )
        jobs.extend(searched)
        logger.info(
            "[Naukri] %s searched (%s)",
            len(searched),
            "authenticated" if authenticated else "public",
        )
    except Exception as exc:
        logger.error("[Scheduler] Naukri search failed: %s", exc)

    if "foundit" in tokens and tokens["foundit"].get("bearer_token"):
        try:
            from portals.foundit.auth import FounditAuthClient
            from portals.foundit.jobs import FounditJobClient

            auth = FounditAuthClient()
            auth.bearer_token = tokens["foundit"]["bearer_token"]
            auth.user_id = tokens["foundit"].get("profile_id")
            auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
            jc = FounditJobClient(auth)
            found = jc.search_jobs(keyword=keyword, location=location, experience=experience)
            jobs.extend(found)
            logger.info("[Foundit] %s jobs", len(found))
        except Exception as exc:
            logger.error("[Scheduler] Foundit fetch failed: %s", exc)

    if "linkedin" in tokens:
        try:
            from portals.linkedin.jobs import search_linkedin_jobs

            linkedin_jobs = await asyncio.wait_for(
                search_linkedin_jobs(keyword=keyword, location=location, max_jobs=25),
                timeout=120,
            )
            jobs.extend(linkedin_jobs)
            logger.info("[LinkedIn] %s jobs", len(linkedin_jobs))
        except Exception as exc:
            logger.error("[Scheduler] LinkedIn fetch failed: %s", exc)

    try:
        from portals.greenhouse.jobs import search_greenhouse_jobs

        greenhouse_jobs = await search_greenhouse_jobs(
            keyword=keyword,
            companies=["phonepe", "groww", "postman"],
            location_filter=location,
            max_per_company=10,
        )
        jobs.extend(greenhouse_jobs)
        logger.info("[Greenhouse] %s jobs", len(greenhouse_jobs))
    except Exception as exc:
        logger.error("[Scheduler] Greenhouse fetch failed: %s", exc)

    return jobs


def _scheduler_request_from_preferences(prefs: dict) -> dict:
    return {
        "skills": prefs.get("skills") or [],
        "work_type": prefs.get("work_type") or [],
        "avoid_companies": [str(item).lower() for item in (prefs.get("avoid_companies") or []) if str(item).strip()],
    }


def _job_key(job) -> str:
    return f"{job.portal}:{job.job_id}"


def _primary_value(value, fallback: str) -> str:
    if isinstance(value, list) and value:
        return str(value[0])
    if isinstance(value, str) and value:
        return value
    return fallback


def _get_existing_job_ids(db, user_id: str) -> set:
    """Get set of 'portal:job_id' strings already matched to this user."""
    result = db.table("job_matches").select("job_id").eq("user_id", user_id).execute()
    if not result.data:
        return set()

    job_ids = [row["job_id"] for row in result.data if row.get("job_id")]
    if not job_ids:
        return set()

    jobs_result = db.table("jobs").select("id, portal, job_id").in_("id", job_ids).execute()
    return {f"{row['portal']}:{row['job_id']}" for row in (jobs_result.data or [])}


