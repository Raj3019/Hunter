import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from ai.resume_tailor import tailor_resume
from core.auth import get_current_user_id
from core.database import get_db
from portals.base import run_safe_apply_for_user
from portals.naukri.jobs import Job

router = APIRouter()
logger = logging.getLogger(__name__)
DEFAULT_RESUME_PATH = "./uploads/resume.pdf"


@router.get("/matches")
async def get_job_matches(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("job_matches").select(
        "*, jobs(*)"
    ).eq("user_id", user_id).eq("status", "pending").order(
        "match_score",
        desc=True,
    ).limit(50).execute()
    return {"matches": result.data or []}


@router.post("/{match_id}/approve")
async def approve_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("job_matches").update({"status": "approved"}).eq(
        "id",
        match_id,
    ).eq("user_id", user_id).execute()
    return {"success": True, "status": "approved"}


@router.post("/{match_id}/skip")
async def skip_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    db.table("job_matches").update({"status": "skipped"}).eq(
        "id",
        match_id,
    ).eq("user_id", user_id).execute()
    return {"success": True, "status": "skipped"}


@router.post("/{match_id}/tailor")
async def tailor_for_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    match = db.table("job_matches").select("*, jobs(*)").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).maybe_single().execute()
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    resume_data = db.table("resumes").select("parsed_data, raw_text").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute()
    if not resume_data.data:
        raise HTTPException(status_code=404, detail="No resume found - upload first")

    job = match.data["jobs"]
    tailored = await tailor_resume(
        original_text=resume_data.data.get("raw_text", ""),
        resume_parsed=resume_data.data.get("parsed_data", {}),
        job_description=job.get("description", ""),
        job_title=job.get("title", ""),
    )

    return {"success": True, "tailored": tailored}


@router.post("/{match_id}/apply")
async def apply_to_job(
    match_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    match = db.table("job_matches").select("*, jobs(*)").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).eq("status", "approved").maybe_single().execute()

    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found or not approved")

    background_tasks.add_task(_run_apply, user_id, match.data)
    return {"success": True, "message": "Apply queued - check Tracker for result"}


async def _run_apply(user_id: str, match_data: dict):
    db = get_db()
    job_data = match_data["jobs"]
    job = _build_job(job_data)

    try:
        result = await run_safe_apply_for_user(
            user_id=user_id,
            job=job,
            apply_callable=lambda: _apply_for_portal(db, user_id, job),
            tailored_resume_url=match_data.get("tailored_resume_url", ""),
        )
        logger.info("Apply result for %s:%s - %s", job.portal, job.job_id, result)
    except Exception as exc:
        logger.error("Background apply failed for match %s: %s", match_data.get("id"), exc)
        db.table("job_matches").update({"status": "pending"}).eq(
            "id",
            match_data["id"],
        ).execute()


async def _apply_for_portal(db, user_id: str, job: Job) -> dict:
    if job.portal == "naukri":
        token_row = _get_portal_token(db, user_id, "naukri")
        if not token_row:
            return {"success": False, "reason": "Naukri token missing"}
        from portals.naukri.auth import NaukriAuthClient
        from portals.naukri.jobs import NaukriJobClient

        auth = NaukriAuthClient()
        auth.bearer_token = token_row["bearer_token"]
        auth.profile_id = token_row.get("profile_id")
        auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
        return NaukriJobClient(auth).apply_job(job)

    if job.portal == "foundit":
        token_row = _get_portal_token(db, user_id, "foundit")
        if not token_row:
            return {"success": False, "reason": "Foundit token missing"}
        from portals.foundit.auth import FounditAuthClient
        from portals.foundit.jobs import FounditJobClient

        auth = FounditAuthClient()
        auth.bearer_token = token_row["bearer_token"]
        auth.user_id = token_row.get("profile_id")
        auth.session.headers.update({"Authorization": f"Bearer {auth.bearer_token}"})
        return FounditJobClient(auth).apply_job(job)

    user_profile = _get_user_profile(db, user_id)

    if job.portal == "linkedin":
        from portals.linkedin.apply import linkedin_easy_apply

        return await linkedin_easy_apply(job, user_profile)

    if job.portal == "workday":
        from portals.workday.apply import workday_apply

        return await workday_apply(job, DEFAULT_RESUME_PATH, user_profile)

    if job.portal == "taleo":
        from portals.taleo.apply import taleo_apply

        return await taleo_apply(job, DEFAULT_RESUME_PATH, user_profile)

    if job.portal == "greenhouse":
        from portals.greenhouse.apply import greenhouse_apply

        return await greenhouse_apply(job, DEFAULT_RESUME_PATH, user_profile)

    return {"success": False, "reason": f"No apply handler for portal: {job.portal}"}


def _build_job(job_data: dict) -> Job:
    return Job(
        job_id=job_data["job_id"],
        title=job_data.get("title", ""),
        company=job_data.get("company", ""),
        location=job_data.get("location", ""),
        experience=job_data.get("experience", ""),
        salary=job_data.get("salary", ""),
        posted_date=job_data.get("posted_date", ""),
        apply_link=job_data.get("apply_link", ""),
        description=job_data.get("description", ""),
        portal=job_data["portal"],
        tags=job_data.get("tags") or [],
        has_questionnaire=job_data.get("has_questionnaire", False),
        is_workday=job_data.get("is_workday", False),
        is_taleo=job_data.get("is_taleo", False),
    )


def _get_portal_token(db, user_id: str, portal: str) -> dict | None:
    result = db.table("portal_tokens").select("*").eq(
        "user_id",
        user_id,
    ).eq("portal", portal).maybe_single().execute()
    return result.data


def _get_user_profile(db, user_id: str) -> dict:
    resume_row = db.table("resumes").select("parsed_data").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute()
    return resume_row.data.get("parsed_data", {}) if resume_row.data else {}
