import asyncio
import logging
import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
import httpx

from ai.resume_tailor import tailor_resume
from core.auth import get_current_user_id
from core.database import NULL_RESULT, get_db
from core.storage import create_signed_resume_url
from portals.base import SafeApplyManager
from portals.naukri.jobs import Job
from services.tailored_resume_service import create_tailored_resume_draft
from services.job_discovery import DiscoveryError, enrich_match_context, run_manual_search

router = APIRouter()
logger = logging.getLogger(__name__)
VISIBLE_MATCH_STATUSES = ["pending", "approved", "blocked", "needs_review", "failed", "external_pending"]
COMPLETED_APPLICATION_STATUSES = {"applied", "viewed", "interview", "offer"}
_manual_search_locks: set[str] = set()
MANUAL_SEARCH_ROUTE_TIMEOUT_SECONDS = 170


class TailorApprovalIn(BaseModel):
    tailored_resume_id: str


class ManualSearchIn(BaseModel):
    query: str = ""
    locations: list[str] | None = None
    experience_years: int | None = None
    portals: list[str] = Field(default_factory=lambda: ["naukri"])
    max_pages: int = 1
    results_per_page: int = 20
    min_score: int = 60
    freshness_days: int = 30
    save_as_preferences: bool = False


class JobSnapshotIn(BaseModel):
    job_id: str
    title: str = ""
    company: str = ""
    location: str = ""
    experience: str = ""
    salary: str = ""
    posted_date: str = ""
    apply_link: str = ""
    description: str = ""
    portal: str
    tags: list[str] = Field(default_factory=list)
    has_questionnaire: bool = False
    is_workday: bool = False
    is_taleo: bool = False
    apply_method: str = "unknown"
    external_apply_url: str = ""
    portal_metadata: dict = Field(default_factory=dict)


class ApplySnapshotIn(BaseModel):
    job: JobSnapshotIn


@router.get("/matches")
async def get_job_matches(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("job_matches").select("*, jobs(*)").eq(
        "user_id",
        user_id,
    ).in_("status", VISIBLE_MATCH_STATUSES).order(
        "match_score",
        desc=True,
    ).execute()
    prefs = db.table("preferences").select("*").eq(
        "user_id",
        user_id,
    ).maybe_single().execute() or NULL_RESULT
    resume = db.table("resumes").select("parsed_data").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    min_score = int((prefs.data or {}).get("auto_apply_min_score") or 60)
    matches = [
        enrich_match_context(
            row,
            prefs=prefs.data or {},
            resume=(resume.data or {}).get("parsed_data") if resume.data else None,
            min_score=min_score,
        )
        for row in (result.data or [])
    ]
    return {"matches": matches}


@router.post("/search")
async def search_jobs(body: ManualSearchIn, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    lock_key = _manual_search_lock_key(user_id, body)
    if lock_key in _manual_search_locks:
        raise HTTPException(status_code=409, detail="Search is already running.")

    _manual_search_locks.add(lock_key)
    try:
        return await asyncio.wait_for(
            run_manual_search(
                db,
                user_id=user_id,
                query=body.query,
                locations=body.locations,
                experience_years=body.experience_years,
                portals=body.portals,
                max_pages=body.max_pages,
                results_per_page=body.results_per_page,
                min_score=body.min_score,
                freshness_days=body.freshness_days,
                save_as_preferences=body.save_as_preferences,
            ),
            timeout=MANUAL_SEARCH_ROUTE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=504,
            detail="Manual search took too long. Try a narrower query or run the search again later.",
        ) from exc
    except DiscoveryError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    finally:
        _manual_search_locks.discard(lock_key)


@router.post("/{match_id}/approve")
async def approve_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    match = db.table("job_matches").select("*, jobs(*)").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    job = _build_job(match.data["jobs"])
    if _requires_external_confirmation(job):
        result = _external_pending_result(job)
        result["apply_mode"] = "manual"
        result["pre_apply_check"] = {
            "ok": True,
            "apply_mode": "manual",
            "checks": ["external_apply_detected"],
        }
        SafeApplyManager().log_application(user_id, job, result)
        db.table("job_matches").update({"status": "external_pending"}).eq(
            "id",
            match_id,
        ).eq("user_id", user_id).execute()
        return {
            "success": True,
            "status": "external_pending",
            "external_pending": True,
            "external_apply_url": result.get("external_apply_url", ""),
        }

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


@router.post("/apply-snapshot")
async def apply_job_snapshot(
    body: ApplySnapshotIn,
    user_id: str = Depends(get_current_user_id),
):
    return _open_portal_for_snapshot(user_id, body.job.dict())


@router.post("/open-portal-snapshot")
async def open_portal_job_snapshot(
    body: ApplySnapshotIn,
    user_id: str = Depends(get_current_user_id),
):
    return _open_portal_for_snapshot(user_id, body.job.dict())


@router.post("/{match_id}/open-portal")
async def open_portal_for_match(
    match_id: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    match = db.table("job_matches").select("*, jobs(*)").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    return _open_portal_for_match_data(db, user_id, match.data)


def _open_portal_for_snapshot(user_id: str, job_data: dict) -> dict:
    db = get_db()
    job = _build_job(job_data)
    db_job_id = SafeApplyManager()._get_or_create_db_job_id(job)
    if not db_job_id:
        raise HTTPException(status_code=500, detail="Could not save job snapshot before opening portal")

    resume_artifact = _get_base_resume_artifact(db, user_id)
    checks = _portal_open_checks_for_snapshot(db, user_id, job, resume_artifact, db_job_id)
    application = _record_portal_open(
        db,
        user_id=user_id,
        db_job_id=db_job_id,
        job=job,
        resume_artifact=resume_artifact,
        checks=checks,
    )
    return application


def _open_portal_for_match_data(db, user_id: str, match_data: dict) -> dict:
    job = _build_job(match_data["jobs"])
    db_job_id = match_data.get("job_id") or SafeApplyManager()._get_or_create_db_job_id(job)
    if not db_job_id:
        raise HTTPException(status_code=500, detail="Could not resolve job before opening portal")

    resume_artifact = _get_resume_artifact(db, user_id, match_data)
    checks = _portal_open_checks(db, user_id, match_data, job, resume_artifact)
    application = _record_portal_open(
        db,
        user_id=user_id,
        db_job_id=db_job_id,
        job=job,
        resume_artifact=resume_artifact,
        checks=checks,
    )
    db.table("job_matches").update({"status": "external_pending"}).eq(
        "id",
        match_data["id"],
    ).eq("user_id", user_id).execute()
    return application


def _record_portal_open(
    db,
    *,
    user_id: str,
    db_job_id: str,
    job: Job,
    resume_artifact: dict,
    checks: dict,
) -> dict:
    portal_url = _best_portal_url(job)
    if not portal_url:
        raise HTTPException(status_code=400, detail="This job does not have a portal URL to open.")

    existing = db.table("applications").select("id, status").eq(
        "user_id",
        user_id,
    ).eq("job_id", db_job_id).order(
        "applied_at",
        desc=True,
    ).limit(1).execute()
    existing_row = (existing.data or [None])[0]

    payload = {
        "user_id": user_id,
        "job_id": db_job_id,
        "portal": job.portal,
        "status": "external_pending",
        "apply_mode": "manual",
        "pre_apply_check": checks,
        "portal_response": {
            "source": job.portal,
            "action": "open_portal",
            "message": "Opened the original portal page for user-completed application.",
        },
        "external_apply_url": portal_url,
        "tailored_resume_url": resume_artifact.get("url", ""),
        "resume_version": resume_artifact.get("version", ""),
        "blocked_reason": "",
        "failed_reason": "",
        "notes": "Waiting for user confirmation after opening the original portal page.",
    }

    if existing_row and existing_row.get("status") in COMPLETED_APPLICATION_STATUSES:
        return {
            "success": True,
            "status": existing_row.get("status"),
            "external_apply_url": portal_url,
            "application_id": existing_row.get("id", ""),
            "already_completed": True,
        }

    if existing_row:
        result = db.table("applications").update(payload).eq(
            "id",
            existing_row["id"],
        ).eq("user_id", user_id).execute()
        application_id = (result.data or [existing_row])[0].get("id", existing_row["id"])
    else:
        result = db.table("applications").insert(payload).execute()
        application_id = (result.data or [{}])[0].get("id", "")

    return {
        "success": True,
        "status": "external_pending",
        "external_pending": True,
        "external_apply_url": portal_url,
        "application_id": application_id,
    }


@router.post("/{match_id}/tailor")
async def tailor_for_match(match_id: str, user_id: str = Depends(get_current_user_id)):
    db = get_db()
    match = db.table("job_matches").select("*, jobs(*)").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    resume_data = db.table("resumes").select("id, parsed_data, raw_text, file_url, created_at").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    if not resume_data.data:
        raise HTTPException(status_code=404, detail="No resume found - upload first")

    job = match.data["jobs"]
    tailored = await tailor_resume(
        original_text=resume_data.data.get("raw_text", ""),
        resume_parsed=resume_data.data.get("parsed_data", {}),
        job_description=job.get("description", ""),
        job_title=job.get("title", ""),
    )
    draft = create_tailored_resume_draft(
        db=db,
        user_id=user_id,
        match_data=match.data,
        resume_data=resume_data.data,
        tailored=tailored,
    )

    return {"success": True, "tailored": draft.get("tailoring") or tailored, "draft": draft}


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
    ).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    if not match.data:
        raise HTTPException(status_code=404, detail="Match not found")

    draft = db.table("tailored_resumes").select("*").eq(
        "id",
        body.tailored_resume_id,
    ).eq("match_id", match_id).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    if not draft.data:
        raise HTTPException(status_code=404, detail="Tailored resume draft not found")

    validation = draft.data.get("validation_json") or {}
    if draft.data.get("status") == "failed_validation" or not validation.get("ok", True):
        raise HTTPException(status_code=400, detail="Tailored resume draft has validation blockers")

    if not draft.data.get("file_url"):
        raise HTTPException(status_code=400, detail="Tailored resume draft has no generated file")

    db.table("tailored_resumes").update({"status": "superseded"}).eq(
        "user_id",
        user_id,
    ).eq("match_id", match_id).eq("status", "approved").neq(
        "id",
        body.tailored_resume_id,
    ).execute()

    db.table("tailored_resumes").update({
        "status": "approved",
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }).eq(
        "id",
        body.tailored_resume_id,
    ).eq("user_id", user_id).execute()

    payload = {
        "tailored_resume_approved": True,
        "tailored_resume_url": draft.data.get("file_url"),
        "tailored_resume_version": draft.data.get("version"),
    }

    db.table("job_matches").update(payload).eq(
        "id",
        match_id,
    ).eq("user_id", user_id).execute()
    return {
        "success": True,
        "tailored_resume_approved": True,
        "tailored_resume_id": body.tailored_resume_id,
        "tailored_resume_version": draft.data.get("version"),
        "tailored_resume_url": create_signed_resume_url(db, draft.data.get("file_url", "")),
    }


@router.post("/{match_id}/apply")
async def apply_to_job(
    match_id: str,
    user_id: str = Depends(get_current_user_id),
):
    db = get_db()
    match = db.table("job_matches").select("*, jobs(*)").eq(
        "id",
        match_id,
    ).eq("user_id", user_id).maybe_single().execute() or NULL_RESULT

    if not match.data or match.data.get("status") not in {"pending", "approved"}:
        raise HTTPException(status_code=404, detail="Match not found or not ready to apply")

    return _open_portal_for_match_data(db, user_id, match.data)


async def _run_manual_apply(user_id: str, match_data: dict):
    db = get_db()
    job_data = match_data["jobs"]
    job = _build_job(job_data)
    manager = SafeApplyManager()
    if _requires_external_confirmation(job):
        result = _external_pending_result(job)
        result["apply_mode"] = "manual"
        result["pre_apply_check"] = {
            "ok": True,
            "apply_mode": "manual",
            "checks": ["external_apply_detected"],
        }
        manager.log_application(user_id, job, result)
        db.table("job_matches").update({"status": "external_pending"}).eq(
            "id",
            match_data["id"],
        ).execute()
        logger.info("Manual apply converted to external pending for %s:%s", job.portal, job.job_id)
        return

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
            next_status = (
                "applied" if manager._is_apply_success(result) else
                "external_pending" if manager._is_external_pending(result) else
                "failed"
            )
            manager.update_job_match_status(
                user_id,
                db_job_id,
                next_status,
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


async def _run_manual_apply_snapshot(user_id: str, job_data: dict):
    db = get_db()
    job = _build_job(job_data)
    manager = SafeApplyManager()
    resume_artifact = _get_base_resume_artifact(db, user_id)
    checks = _pre_apply_checks_for_snapshot(db, user_id, job, resume_artifact)
    staged_resume_path = ""

    try:
        if not checks["ok"]:
            logger.info("Manual snapshot apply blocked for %s:%s - %s", job.portal, job.job_id, checks["reason"])
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
        logger.info("Snapshot apply result for %s:%s - %s", job.portal, job.job_id, result)
    except Exception as exc:
        logger.error("Background snapshot apply failed for %s:%s: %s", job.portal, job.job_id, exc)
    finally:
        if (
            staged_resume_path
            and staged_resume_path != resume_artifact.get("url")
            and os.path.exists(staged_resume_path)
        ):
            os.unlink(staged_resume_path)


async def _apply_for_portal(db, user_id: str, job: Job, resume_path: str = "") -> dict:
    if job.portal == "naukri":
        return {
            "success": False,
            "action": "open_portal",
            "reason": "Naukri auto-apply is dormant in the MVP. Open the original portal page instead.",
        }

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
        apply_method=job_data.get("apply_method") or "unknown",
        external_apply_url=job_data.get("external_apply_url") or "",
        portal_metadata=job_data.get("portal_metadata") or {},
    )


def _requires_external_confirmation(job: Job) -> bool:
    apply_method = (job.apply_method or "unknown").lower()
    if apply_method == "external":
        return True
    return False


def _external_pending_result(job: Job) -> dict:
    return {
        "success": False,
        "external_pending": True,
        "apply_method": "external",
        "reason": "This job must be completed on the company website.",
        "external_apply_url": job.external_apply_url or job.apply_link,
        "portal_response": {
            "source": job.portal,
            "apply_method": job.apply_method or "unknown",
            "portal_metadata": job.portal_metadata,
        },
    }


def _get_portal_token(db, user_id: str, portal: str) -> dict | None:
    result = db.table("portal_tokens").select("*").eq(
        "user_id",
        user_id,
    ).eq("portal", portal).maybe_single().execute() or NULL_RESULT
    return result.data


def _manual_search_lock_key(user_id: str, body: ManualSearchIn) -> str:
    query = (body.query or "").strip().lower()
    locations = ",".join(sorted([item.strip().lower() for item in body.locations or [] if item.strip()]))
    portals = ",".join(sorted([item.strip().lower() for item in body.portals or [] if item.strip()]))
    return f"{user_id}:{query}:{locations}:{portals}"


def _get_resume_artifact(db, user_id: str, match_data: dict) -> dict:
    if match_data.get("tailored_resume_approved") and match_data.get("tailored_resume_url"):
        return {
            "url": create_signed_resume_url(db, match_data.get("tailored_resume_url", "")),
            "version": match_data.get("tailored_resume_version") or "tailored",
        }

    resume = db.table("resumes").select("file_url, created_at").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    if not resume.data:
        return {"url": "", "version": ""}

    return {
        "url": create_signed_resume_url(db, resume.data.get("file_url", "")),
        "version": f"base:{resume.data.get('created_at', '')}",
    }


def _get_base_resume_artifact(db, user_id: str) -> dict:
    resume = db.table("resumes").select("file_url, created_at").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    if not resume.data:
        return {"url": "", "version": ""}

    return {
        "url": create_signed_resume_url(db, resume.data.get("file_url", "")),
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

    if match_data.get("status") not in {"pending", "approved"}:
        return fail("Match is not ready to apply")

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
    ).eq("job_id", match_data.get("job_id")).execute()
    if _has_completed_application(existing.data):
        return fail("Already applied to this job")

    checks["checks"] = [
        "user_reviewed",
        "portal_session_or_token_checked",
        "resume_available",
        "duplicate_checked",
        "source_status_checked",
    ]
    return checks


def _pre_apply_checks_for_snapshot(
    db,
    user_id: str,
    job: Job,
    resume_artifact: dict,
) -> dict:
    checks = {
        "ok": True,
        "apply_mode": "manual",
        "checks": [],
    }

    def fail(reason: str) -> dict:
        checks["ok"] = False
        checks["reason"] = reason
        checks["status"] = "blocked"
        return checks

    if not job.job_id:
        return fail("Portal job id missing")

    if not resume_artifact.get("url"):
        return fail("No resume found - upload first")

    if job.has_questionnaire:
        return fail("Questionnaire requires user review before apply")

    if job.portal in {"naukri", "foundit"} and not _get_portal_token(db, user_id, job.portal):
        return fail(f"{job.portal.title()} token missing")

    existing_job = db.table("jobs").select("id").eq(
        "portal",
        job.portal,
    ).eq("job_id", job.job_id).limit(1).execute()
    existing_job_id = existing_job.data[0]["id"] if existing_job.data else ""
    if existing_job_id:
        existing = db.table("applications").select("id, status").eq(
            "user_id",
            user_id,
        ).eq("job_id", existing_job_id).execute()
        if _has_completed_application(existing.data):
            return fail("Already applied to this job")

    checks["checks"] = [
        "user_reviewed",
        "portal_session_or_token_checked",
        "resume_available",
        "duplicate_checked",
    ]
    return checks


def _portal_open_checks(
    db,
    user_id: str,
    match_data: dict,
    job: Job,
    resume_artifact: dict,
) -> dict:
    checks = _base_portal_open_checks(job, resume_artifact)
    existing = db.table("applications").select("id, status").eq(
        "user_id",
        user_id,
    ).eq("job_id", match_data.get("job_id")).execute()
    if _has_completed_application(existing.data):
        checks["warnings"].append("This job is already marked as applied in Tracker.")
    return checks


def _portal_open_checks_for_snapshot(
    db,
    user_id: str,
    job: Job,
    resume_artifact: dict,
    db_job_id: str,
) -> dict:
    checks = _base_portal_open_checks(job, resume_artifact)
    existing = db.table("applications").select("id, status").eq(
        "user_id",
        user_id,
    ).eq("job_id", db_job_id).execute()
    if _has_completed_application(existing.data):
        checks["warnings"].append("This job is already marked as applied in Tracker.")
    return checks


def _base_portal_open_checks(job: Job, resume_artifact: dict) -> dict:
    checks = {
        "ok": True,
        "apply_mode": "manual",
        "checks": ["user_selected_job", "source_portal_url_checked"],
        "warnings": [],
    }
    if not _best_portal_url(job):
        checks["ok"] = False
        checks["reason"] = "Portal URL missing"
    if not resume_artifact.get("url"):
        checks["warnings"].append("No resume is uploaded in Hunter yet.")
    if job.has_questionnaire:
        checks["warnings"].append("The portal may ask additional questions before submission.")
    return checks


def _best_portal_url(job: Job) -> str:
    return _normalize_portal_url(
        job.external_apply_url or job.apply_link,
        job.portal,
    )


def _normalize_portal_url(url: str, portal: str) -> str:
    value = (url or "").strip()
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value

    path = value if value.startswith("/") else f"/{value}"
    normalized_portal = (portal or "").lower()
    if normalized_portal == "naukri":
        return f"https://www.naukri.com{path}"
    if normalized_portal == "foundit":
        return f"https://www.foundit.in{path}"
    if normalized_portal == "linkedin":
        return f"https://www.linkedin.com{path}"
    return value


def _has_completed_application(rows: list[dict] | None) -> bool:
    return any((row.get("status") or "") in COMPLETED_APPLICATION_STATUSES for row in (rows or []))


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
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    return resume_row.data.get("parsed_data", {}) if resume_row.data else {}
