import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from core.database import get_db

logger = logging.getLogger(__name__)
IST = ZoneInfo("Asia/Kolkata")
MATCH_THRESHOLD = 60


async def daily_job_fetch():
    """
    Main scheduled task. Runs at 8am IST daily.
    For each active user:
      1. Load their resume + preferences
      2. Search all connected portals
      3. Score each job with AI
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
        profile = db.table("profiles").select("*").eq("id", uid).maybe_single().execute()
        if profile.data:
            users.append(profile.data)
    return users


async def _process_user(db, user: dict):
    user_id = user["id"]
    logger.info("[Scheduler] Processing user: %s", user_id)

    prefs_result = db.table("preferences").select("*").eq(
        "user_id",
        user_id,
    ).maybe_single().execute()
    if not prefs_result.data:
        logger.info("[Scheduler] User %s has no preferences set - skipping", user_id)
        return
    prefs = prefs_result.data

    resume_result = db.table("resumes").select("parsed_data, raw_text").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute()
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

    existing_job_ids = _get_existing_job_ids(db, user_id)
    new_jobs = [job for job in all_jobs if _job_key(job) not in existing_job_ids]
    logger.info(
        "[Scheduler] User %s: %s new jobs after deduplication",
        user_id,
        len(new_jobs),
    )

    from ai.job_scorer import score_job

    saved_count = 0
    for job in new_jobs:
        try:
            job_dict = _job_to_dict(job)
            db_job_id = _upsert_job(db, job_dict)
            if not db_job_id:
                continue

            score_result = await score_job(resume, job_dict)
            if int(score_result.get("score", 0)) >= MATCH_THRESHOLD:
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
        except Exception as exc:
            logger.warning("[Scheduler] Error scoring job %s: %s", _job_key(job), exc)
            continue

    logger.info(
        "[Scheduler] User %s: saved %s matches with score >= %s",
        user_id,
        saved_count,
        MATCH_THRESHOLD,
    )


async def _fetch_all_portals(db, user_id: str, prefs: dict) -> list:
    """Fetch jobs from all portals the user has connected."""
    jobs = []
    keywords = prefs.get("job_titles") or ["Software Developer"]
    locations = prefs.get("locations") or ["Bangalore"]
    experience = prefs.get("experience_years", 0) or 0

    keyword = keywords[0] if keywords else "Software Developer"
    location = locations[0] if locations else "Bangalore"

    tokens_result = db.table("portal_tokens").select("*").eq("user_id", user_id).execute()
    tokens = {row["portal"]: row for row in (tokens_result.data or []) if row.get("portal")}

    if "naukri" in tokens and tokens["naukri"].get("bearer_token"):
        try:
            from portals.naukri.auth import NaukriAuthClient
            from portals.naukri.jobs import NaukriJobClient

            auth = NaukriAuthClient()
            auth.bearer_token = tokens["naukri"]["bearer_token"]
            auth.profile_id = tokens["naukri"].get("profile_id")
            auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
            jc = NaukriJobClient(auth)
            reco = jc.get_recommended_jobs()
            searched = await jc.search_jobs(
                keyword=keyword,
                location=location,
                experience=experience,
            )
            jobs.extend(reco + searched)
            logger.info("[Naukri] %s recommended + %s searched", len(reco), len(searched))
        except Exception as exc:
            logger.error("[Scheduler] Naukri fetch failed: %s", exc)

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


def _job_key(job) -> str:
    return f"{job.portal}:{job.job_id}"


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
    """Insert job if it does not exist; return the DB uuid."""
    try:
        result = db.table("jobs").upsert(
            job_dict,
            on_conflict="portal,job_id",
        ).execute()
        if result.data:
            return result.data[0]["id"]

        existing = db.table("jobs").select("id").eq(
            "portal",
            job_dict["portal"],
        ).eq("job_id", job_dict["job_id"]).limit(1).execute()
        if existing.data:
            return existing.data[0]["id"]
    except Exception as exc:
        logger.error(
            "Failed to upsert job %s:%s: %s",
            job_dict.get("portal"),
            job_dict.get("job_id"),
            exc,
        )
    return None
