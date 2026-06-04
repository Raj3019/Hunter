import logging
import os
import tempfile

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
import httpx

from ai.resume_tailor import tailor_resume
from core.auth import get_current_user_id
from core.database import get_db
from portals.base import SafeApplyManager
from portals.naukri.jobs import Job

router = APIRouter()
logger = logging.getLogger(__name__)
VISIBLE_MATCH_STATUSES = ["pending", "approved", "blocked", "needs_review", "failed"]


class TailorApprovalIn(BaseModel):
    tailored_resume_url: str = ""
    tailored_resume_version: str = "tailored"


@router.get("/matches")
async def get_job_matches(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("job_matches").select(
        "*, jobs(*)"
    ).eq("user_id", user_id).in_("status", VISIBLE_MATCH_STATUSES).order(
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


@router.post("/{match_id}/tailor/approve")
async def approve_tailored_resume(
    match_id: str,
    body: TailorApprovalIn,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    match = db.table("job_matches").select("id").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).maybe_single().execute()
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    payload = {
        "tailored_resume_approved": True,
        "tailored_resume_version": body.tailored_resume_version,
    }
    if body.tailored_resume_url:
        payload["tailored_resume_url"] = body.tailored_resume_url

    db.table("job_matches").update(payload).eq(
        "id",
        match_id,
    ).eq("user_id", user_id).execute()
    return {
        "success": True,
        "tailored_resume_approved": True,
        "tailored_resume_version": body.tailored_resume_version,
        "tailored_resume_url": body.tailored_resume_url,
    }


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

    background_tasks.add_task(_run_manual_apply, user_id, match.data)
    return {"success": True, "message": "Apply started - check Tracker for result"}


async def _run_manual_apply(user_id: str, match_data: dict):
    db = get_db()
    job_data = match_data["jobs"]
    job = _build_job(job_data)
    manager = SafeApplyManager()
    resume_artifact = _get_resume_artifact(db, user_id, match_data)
    checks = _pre_apply_checks(db, user_id, match_data, job, resume_artifact)
    staged_resume_path = ""

    try:
        if not checks["ok"]:
            result = {
                "success": False,
                "blocked": True,
                "reason": checks["reason"],
                "apply_mode": "manual",
                "pre_apply_check": checks,
                "resume_version": resume_artifact.get("version", ""),
            }
            manager.log_application(
                user_id,
                job,
                result,
                tailored_resume_url=resume_artifact.get("url", ""),
                resume_version=resume_artifact.get("version", ""),
            )
            db.table("job_matches").update({"status": checks.get("status", "blocked")}).eq(
                "id",
                match_data["id"],
            ).execute()
            logger.info("Manual apply blocked for %s:%s - %s", job.portal, job.job_id, checks["reason"])
            return

        staged_resume_path = await _stage_resume_file(resume_artifact.get("url", ""))
        result = await _apply_for_portal(db, user_id, job, staged_resume_path)
        result["apply_mode"] = "manual"
        result["pre_apply_check"] = checks
        result["resume_version"] = resume_artifact.get("version", "")

        manager.log_application(
            user_id,
            job,
            result,
            tailored_resume_url=resume_artifact.get("url", ""),
            resume_version=resume_artifact.get("version", ""),
        )
        db_job_id = manager._get_or_create_db_job_id(job)
        if db_job_id:
            manager.update_job_match_status(
                user_id,
                db_job_id,
                "applied" if manager._is_apply_success(result) else "failed",
            )
        logger.info("Apply result for %s:%s - %s", job.portal, job.job_id, result)
    except Exception as exc:
        logger.error("Background apply failed for match %s: %s", match_data.get("id"), exc)
        result = {
            "success": False,
            "reason": str(exc),
            "apply_mode": "manual",
            "pre_apply_check": checks,
            "resume_version": resume_artifact.get("version", ""),
        }
        manager.log_application(
            user_id,
            job,
            result,
            tailored_resume_url=resume_artifact.get("url", ""),
            resume_version=resume_artifact.get("version", ""),
        )
        db.table("job_matches").update({"status": "failed"}).eq(
            "id",
            match_data["id"],
        ).execute()
    finally:
        if (
            staged_resume_path
            and staged_resume_path != resume_artifact.get("url")
            and os.path.exists(staged_resume_path)
        ):
            os.unlink(staged_resume_path)


async def _apply_for_portal(db, user_id: str, job: Job, resume_path: str = "") -> dict:
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

        if not resume_path:
            return {"success": False, "reason": "Resume file unavailable for Workday upload"}
        return await workday_apply(job, resume_path, user_profile)

    if job.portal == "taleo":
        from portals.taleo.apply import taleo_apply

        if not resume_path:
            return {"success": False, "reason": "Resume file unavailable for Taleo upload"}
        return await taleo_apply(job, resume_path, user_profile)

    if job.portal == "greenhouse":
        from portals.greenhouse.apply import greenhouse_apply

        if not resume_path:
            return {"success": False, "reason": "Resume file unavailable for Greenhouse upload"}
        return await greenhouse_apply(job, resume_path, user_profile)

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


def _get_resume_artifact(db, user_id: str, match_data: dict) -> dict:
    if match_data.get("tailored_resume_approved") and match_data.get("tailored_resume_url"):
        return {
            "url": match_data.get("tailored_resume_url", ""),
            "version": match_data.get("tailored_resume_version") or "tailored",
        }

    resume = db.table("resumes").select("file_url, created_at").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute()
    if not resume.data:
        return {"url": "", "version": ""}

    return {
        "url": resume.data.get("file_url", ""),
        "version": f"base:{resume.data.get('created_at', '')}",
    }


def _pre_apply_checks(
    db,
    user_id: str,
    match_data: dict,
    job: Job,
    resume_artifact: dict,
) -> dict:
    checks = {
        "ok": True,
        "apply_mode": "manual",
        "checks": [],
    }

    def fail(reason: str, status: str = "blocked") -> dict:
        checks["ok"] = False
        checks["reason"] = reason
        checks["status"] = status
        return checks

    if match_data.get("status") != "approved":
        return fail("Match is not approved")

    if not job.job_id:
        return fail("Portal job id missing")

    if (match_data.get("jobs") or {}).get("source_status") == "closed":
        return fail("Job is marked closed on the source portal")

    if not resume_artifact.get("url"):
        return fail("No resume found - upload first")

    if job.has_questionnaire:
        return fail("Questionnaire requires user review before apply", status="needs_review")

    if job.portal in {"naukri", "foundit"} and not _get_portal_token(db, user_id, job.portal):
        return fail(f"{job.portal.title()} token missing")

    existing = db.table("applications").select("id, status").eq(
        "user_id",
        user_id,
    ).eq("job_id", match_data.get("job_id")).in_(
        "status",
        ["applied", "viewed", "interview", "offer"],
    ).limit(1).execute()
    if existing.data:
        return fail("Already applied to this job")

    checks["checks"] = [
        "approved",
        "portal_session_or_token_checked",
        "resume_available",
        "duplicate_checked",
        "source_status_checked",
    ]
    return checks


async def _stage_resume_file(resume_url: str) -> str:
    if not resume_url:
        return ""

    if os.path.exists(resume_url):
        return resume_url

    if not resume_url.startswith(("http://", "https://")):
        return ""

    suffix = os.path.splitext(resume_url.split("?", 1)[0])[1] or ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(resume_url)
        response.raise_for_status()

    with open(tmp_path, "wb") as f:
        f.write(response.content)
    return tmp_path


def _get_user_profile(db, user_id: str) -> dict:
    resume_row = db.table("resumes").select("parsed_data").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute()
    return resume_row.data.get("parsed_data", {}) if resume_row.data else {}
