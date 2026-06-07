import asyncio
import logging

from core.database import NULL_RESULT
from datetime import datetime, timezone
from typing import Any

from ai.job_scorer import score_job

logger = logging.getLogger(__name__)

SUPPORTED_MANUAL_PORTALS = {"naukri", "foundit"}
DEFAULT_QUERY = "Software Developer"
DEFAULT_LOCATION = "Bangalore"
DEFAULT_MIN_SCORE = 60
MAX_MANUAL_PAGES = 3
MAX_RESULTS_PER_PAGE = 20
MAX_FRESHNESS_DAYS = 30
MAX_MANUAL_SCORE_JOBS = 60
SCORE_JOB_TIMEOUT_SECONDS = 55
SCORE_CONCURRENCY = 3


class DiscoveryError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


async def run_manual_search(
    db,
    *,
    user_id: str,
    query: str = "",
    locations: list[str] | None = None,
    experience_years: int | None = None,
    portals: list[str] | None = None,
    page: int = 1,
    results_per_page: int = MAX_RESULTS_PER_PAGE,
    min_score: int = DEFAULT_MIN_SCORE,
    freshness_days: int = MAX_FRESHNESS_DAYS,
    save_as_preferences: bool = False,
) -> dict:
    page = max(1, int(page or 1))
    prefs = _get_preferences(db, user_id)
    request = _normalize_request(
        prefs=prefs,
        query=query,
        locations=locations,
        experience_years=experience_years,
        portals=portals,
        max_pages=1,
        results_per_page=results_per_page,
        min_score=min_score,
        freshness_days=freshness_days,
    )
    resume = _get_latest_resume(db, user_id)
    tokens = _get_portal_tokens(db, user_id)
    _validate_connected_portals(request["portals"], tokens)

    if save_as_preferences:
        _save_preferences_from_search(db, user_id, request)

    run_id = _create_search_run(db, user_id, request)
    warnings: list[str] = []

    try:
        fetched_jobs = await search_portals(
            user_id=user_id,
            tokens=tokens,
            query=request["query"],
            locations=request["locations"],
            experience_years=request["experience_years"],
            portals=request["portals"],
            page=page,
            results_per_page=request["results_per_page"],
            freshness_days=request["freshness_days"],
            warnings=warnings,
        )
        # If a portal returned a full page worth, there are likely more pages.
        has_more = len(fetched_jobs) >= request["results_per_page"]
        preference_jobs = _filter_jobs_by_preferences(fetched_jobs, request, warnings)
        unique_jobs = _unique_jobs(preference_jobs)
        existing_keys = _get_existing_applied_job_ids(db, user_id)
        new_jobs = [job for job in unique_jobs if _job_key(job) not in existing_keys]
        jobs_to_score = new_jobs[:MAX_MANUAL_SCORE_JOBS]
        if len(new_jobs) > len(jobs_to_score):
            warnings.append(
                f"Scored the first {len(jobs_to_score)} new jobs from this search. "
                "Run another search or lower the threshold if you want to process more."
            )
        # Ephemeral: score jobs and return them for this session only. Jobs are
        # NOT written to jobs/job_matches here. A job is persisted (as a snapshot
        # + application) only when the user opens its portal / applies.
        matches = await score_matches(
            db,
            user_id=user_id,
            resume=resume,
            jobs=jobs_to_score,
            min_score=request["min_score"],
            source="manual",
            search_run_id=run_id,
            search_query=request["query"],
            search_location=", ".join(request["locations"]),
            warnings=warnings,
            include_below_min_score=True,
            scoring_context=_scoring_context(request, resume, fast=True),
        )
        recommended_count = _count_recommended(matches, request["min_score"])
        portal_counts: dict[str, int] = {}
        for match in matches:
            portal = (match.get("jobs") or {}).get("portal") or ""
            if portal:
                portal_counts[portal] = portal_counts.get(portal, 0) + 1
        run = {
            "id": run_id,
            "status": "completed",
            "query": request["query"],
            "locations": request["locations"],
            "skills": request["skills"],
            "work_type": request["work_type"],
            "portals": request["portals"],
            "fetched_count": len(fetched_jobs),
            "preference_matched_count": len(unique_jobs),
            "new_jobs_count": len(new_jobs),
            "scored_count": len(jobs_to_score),
            "saved_matches_count": len(matches),
            "recommended_count": recommended_count,
            "portal_counts": portal_counts,
            "page": page,
            "has_more": has_more,
            "min_score": request["min_score"],
        }
        _update_search_run(db, run_id, run, warnings=warnings)
        return {
            "success": True,
            "run": run,
            "matches": matches,
            "warnings": warnings,
        }
    except DiscoveryError as exc:
        _mark_search_failed(db, run_id, exc.detail, warnings)
        raise
    except Exception as exc:
        message = f"Manual search failed: {exc}"
        logger.exception("Manual search failed for user %s", user_id)
        _mark_search_failed(db, run_id, message, warnings)
        raise DiscoveryError(500, message) from exc


async def search_portals(
    *,
    user_id: str,
    tokens: dict[str, dict],
    query: str,
    locations: list[str],
    experience_years: int,
    portals: list[str],
    page: int,
    results_per_page: int,
    freshness_days: int,
    warnings: list[str],
) -> list:
    jobs = []
    for portal in portals:
        if portal == "naukri":
            jobs.extend(
                await _search_naukri(
                    user_id=user_id,
                    token_row=tokens.get("naukri") or {},
                    query=query,
                    locations=locations,
                    experience_years=experience_years,
                    page=page,
                    results_per_page=results_per_page,
                    freshness_days=freshness_days,
                    warnings=warnings,
                )
            )
        elif portal == "foundit":
            jobs.extend(
                await _search_foundit(
                    query=query,
                    locations=locations,
                    experience_years=experience_years,
                    page=page,
                    results_per_page=results_per_page,
                    warnings=warnings,
                )
            )
    return jobs


async def _search_foundit(
    *,
    query: str,
    locations: list[str],
    experience_years: int,
    page: int,
    results_per_page: int,
    warnings: list[str],
) -> list:
    from portals.foundit.auth import FounditAuthClient
    from portals.foundit.jobs import FounditJobClient

    # Foundit's public search needs no login (unauthenticated session).
    # Foundit pageNo is 0-indexed, so request page N maps to pageNo N-1.
    client = FounditJobClient(FounditAuthClient())
    foundit_page = max(0, page - 1)
    jobs = []
    for location in (locations or [""]):
        try:
            jobs.extend(await asyncio.to_thread(
                client.search_jobs, query, location, experience_years, foundit_page, results_per_page,
            ))
        except Exception as exc:
            warning = f"Foundit search failed for {query} / {location or 'any location'} page {page}: {_safe_error(exc)}"
            warnings.append(warning)
            logger.warning(warning)
    return jobs


async def score_matches(
    db,
    *,
    user_id: str,
    resume: dict | None,
    jobs: list,
    min_score: int,
    source: str,
    search_run_id: str,
    search_query: str,
    search_location: str,
    warnings: list[str],
    include_below_min_score: bool = False,
    scoring_context: dict | None = None,
) -> list[dict]:
    semaphore = asyncio.Semaphore(SCORE_CONCURRENCY)
    context = scoring_context or _scoring_context({}, resume)

    async def process_job(job) -> dict | None:
        async with semaphore:
            return await _score_one_transient_match(
                resume=context["profile"],
                job=job,
                min_score=min_score,
                source=source,
                search_run_id=search_run_id,
                search_query=search_query,
                search_location=search_location,
                warnings=warnings,
                include_below_min_score=include_below_min_score,
                scoring_context=context,
            )

    results = await asyncio.gather(*(process_job(job) for job in jobs))
    return [match for match in results if match]


async def score_and_save_matches(
    db,
    *,
    user_id: str,
    resume: dict | None,
    jobs: list,
    min_score: int,
    source: str,
    search_run_id: str,
    search_query: str,
    search_location: str,
    warnings: list[str],
    include_below_min_score: bool = False,
    scoring_context: dict | None = None,
) -> list[dict]:
    semaphore = asyncio.Semaphore(SCORE_CONCURRENCY)
    context = scoring_context or _scoring_context({}, resume)

    async def process_job(job) -> dict | None:
        async with semaphore:
            return await _score_and_save_one_match(
                db,
                user_id=user_id,
                resume=context["profile"],
                job=job,
                min_score=min_score,
                source=source,
                search_run_id=search_run_id,
                search_query=search_query,
                search_location=search_location,
                warnings=warnings,
                include_below_min_score=include_below_min_score,
                scoring_context=context,
            )

    results = await asyncio.gather(*(process_job(job) for job in jobs))
    return [match for match in results if match]


async def _score_one_transient_match(
    *,
    resume: dict,
    job,
    min_score: int,
    source: str,
    search_run_id: str,
    search_query: str,
    search_location: str,
    warnings: list[str],
    include_below_min_score: bool = False,
    scoring_context: dict | None = None,
) -> dict | None:
    try:
        job_dict = job_to_dict(job)
        try:
            score_result = await asyncio.wait_for(
                score_job(resume, job_dict),
                timeout=SCORE_JOB_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            warnings.append(f"Scoring timed out for {job.portal}:{job.job_id}")
            logger.warning("Manual search scoring timed out for %s", _job_key(job))
            return None

        score = int(score_result.get("score", 0))
        if score < min_score and not include_below_min_score:
            return None

        return attach_recommendation_context(transient_match(
            job=job_dict,
            score_result=score_result,
            source=source,
            search_run_id=search_run_id,
            search_query=search_query,
            search_location=search_location,
        ), scoring_context, min_score)
    except Exception as exc:
        warnings.append(f"Could not score {getattr(job, 'portal', '')}:{getattr(job, 'job_id', '')}")
        logger.warning("Manual search scoring failed for %s: %s", _job_key(job), exc)
    return None


async def _score_and_save_one_match(
    db,
    *,
    user_id: str,
    resume: dict,
    job,
    min_score: int,
    source: str,
    search_run_id: str,
    search_query: str,
    search_location: str,
    warnings: list[str],
    include_below_min_score: bool = False,
    scoring_context: dict | None = None,
) -> dict | None:
    try:
        job_dict = job_to_dict(job)
        db_job_id = upsert_job(db, job_dict)
        if not db_job_id:
            warnings.append(f"Could not save job {job.portal}:{job.job_id}")
            return None

        try:
            score_result = await asyncio.wait_for(
                score_job(resume, job_dict),
                timeout=SCORE_JOB_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            warnings.append(f"Scoring timed out for {job.portal}:{job.job_id}")
            logger.warning("Manual search scoring timed out for %s", _job_key(job))
            return None

        score = int(score_result.get("score", 0))
        if score < min_score and not include_below_min_score:
            return None

        return attach_recommendation_context(upsert_match(
            db,
            user_id=user_id,
            job_id=db_job_id,
            score_result=score_result,
            source=source,
            search_run_id=search_run_id,
            search_query=search_query,
            search_location=search_location,
        ), scoring_context, min_score)
    except Exception as exc:
        warnings.append(f"Could not score {getattr(job, 'portal', '')}:{getattr(job, 'job_id', '')}")
        logger.warning("Manual search scoring failed for %s: %s", _job_key(job), exc)
    return None


def job_to_dict(job) -> dict:
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
        "apply_method": getattr(job, "apply_method", "unknown"),
        "external_apply_url": getattr(job, "external_apply_url", ""),
        "portal_metadata": getattr(job, "portal_metadata", {}) or {},
    }


def transient_match(
    *,
    job: dict,
    score_result: dict,
    source: str,
    search_run_id: str,
    search_query: str,
    search_location: str,
) -> dict:
    return {
        "id": f"search:{job.get('portal', '')}:{job.get('job_id', '')}",
        "persisted": False,
        "job_id": job.get("job_id", ""),
        "match_score": int(score_result.get("score", 0)),
        "match_reasons": score_result.get("reasons", []),
        "matched_skills": score_result.get("matched_skills", []),
        "missing_skills": score_result.get("missing_skills", []),
        "status": "pending",
        "search_source": source,
        "search_query": search_query,
        "search_location": search_location,
        "search_run_id": search_run_id or None,
        "last_scored_at": _now(),
        "jobs": job,
    }


def enrich_match_context(match: dict, *, prefs: dict | None = None, resume: dict | None = None, min_score: int = DEFAULT_MIN_SCORE) -> dict:
    job = match.get("jobs") or {}
    terms = _preference_terms_from_prefs(prefs or {})
    score = _int_value(match.get("match_score"), 0)
    context = _recommendation_context(
        job=job,
        score=score,
        preference_terms=terms,
        resume_available=_has_resume_evidence(resume),
        min_score=min_score,
    )
    match["recommendation_context"] = context
    return match


def upsert_job(db, job_dict: dict) -> str | None:
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


def upsert_match(
    db,
    *,
    user_id: str,
    job_id: str,
    score_result: dict,
    source: str,
    search_run_id: str,
    search_query: str,
    search_location: str,
) -> dict | None:
    base_payload = {
        "user_id": user_id,
        "job_id": job_id,
        "match_score": int(score_result.get("score", 0)),
        "match_reasons": score_result.get("reasons", []),
        "matched_skills": score_result.get("matched_skills", []),
        "missing_skills": score_result.get("missing_skills", []),
        "status": "pending",
    }
    metadata = {
        "search_source": source,
        "search_query": search_query,
        "search_location": search_location,
        "search_run_id": search_run_id or None,
        "last_scored_at": _now(),
    }

    try:
        result = db.table("job_matches").upsert(
            {**base_payload, **metadata},
            on_conflict="user_id,job_id",
        ).execute()
    except Exception as exc:
        logger.info("Retrying match upsert without search metadata: %s", exc)
        result = db.table("job_matches").upsert(
            base_payload,
            on_conflict="user_id,job_id",
        ).execute()

    if not result.data:
        return None
    match_id = result.data[0].get("id")
    if not match_id:
        return result.data[0]

    expanded = db.table("job_matches").select("*, jobs(*)").eq("id", match_id).limit(1).execute()
    return expanded.data[0] if expanded.data else result.data[0]


def attach_recommendation_context(match: dict | None, scoring_context: dict | None, min_score: int) -> dict | None:
    if not match:
        return match
    job = match.get("jobs") or {}
    preference_terms = (scoring_context or {}).get("preference_terms") or []
    match["recommendation_context"] = _recommendation_context(
        job=job,
        score=_int_value(match.get("match_score"), 0),
        preference_terms=preference_terms,
        resume_available=bool((scoring_context or {}).get("resume_available")),
        min_score=min_score,
    )
    return match


def _normalize_request(
    *,
    prefs: dict,
    query: str,
    locations: list[str] | None,
    experience_years: int | None,
    portals: list[str] | None,
    max_pages: int,
    results_per_page: int,
    min_score: int,
    freshness_days: int,
    ) -> dict:
    saved_titles = _string_list(prefs.get("job_titles"))
    saved_skills = _string_list(prefs.get("skills"))
    normalized_query = (query or "").strip() or (saved_titles[0] if saved_titles else "")
    if not normalized_query and saved_skills:
        normalized_query = " ".join(saved_skills[:3])
    if not normalized_query:
        normalized_query = DEFAULT_QUERY

    normalized_locations = _string_list(locations) or _string_list(prefs.get("locations")) or [DEFAULT_LOCATION]
    normalized_work_type = [item.lower() for item in _string_list(prefs.get("work_type"))]
    normalized_avoid_companies = [item.lower() for item in _string_list(prefs.get("avoid_companies"))]
    normalized_portals = [item.lower() for item in (_string_list(portals) or ["naukri", "foundit"])]
    unsupported = [item for item in normalized_portals if item not in SUPPORTED_MANUAL_PORTALS]
    if unsupported:
        raise DiscoveryError(400, f"Manual search currently supports: {', '.join(sorted(SUPPORTED_MANUAL_PORTALS))}.")

    normalized_experience = _int_value(
        experience_years if experience_years is not None else prefs.get("experience_years"),
        0,
    )
    normalized_max_pages = _int_value(max_pages, 1)
    normalized_results = _int_value(results_per_page, MAX_RESULTS_PER_PAGE)
    normalized_min_score = _int_value(min_score, DEFAULT_MIN_SCORE)
    normalized_freshness = _int_value(freshness_days, MAX_FRESHNESS_DAYS)

    if normalized_max_pages < 1 or normalized_max_pages > MAX_MANUAL_PAGES:
        raise DiscoveryError(400, f"Manual search supports 1-{MAX_MANUAL_PAGES} pages per request.")
    if normalized_results < 1 or normalized_results > MAX_RESULTS_PER_PAGE:
        raise DiscoveryError(400, f"Manual search supports 1-{MAX_RESULTS_PER_PAGE} results per page.")
    if normalized_min_score < 0 or normalized_min_score > 100:
        raise DiscoveryError(400, "Minimum score must be between 0 and 100.")
    if normalized_freshness < 1 or normalized_freshness > MAX_FRESHNESS_DAYS:
        raise DiscoveryError(400, f"Freshness must be between 1 and {MAX_FRESHNESS_DAYS} days.")

    return {
        "query": normalized_query,
        "locations": normalized_locations,
        "skills": saved_skills,
        "work_type": normalized_work_type,
        "min_salary": _int_value(prefs.get("min_salary"), 0),
        "max_salary": _int_value(prefs.get("max_salary"), 0),
        "avoid_companies": normalized_avoid_companies,
        "experience_years": max(0, normalized_experience),
        "portals": normalized_portals,
        "max_pages": normalized_max_pages,
        "results_per_page": normalized_results,
        "min_score": normalized_min_score,
        "freshness_days": normalized_freshness,
    }


async def _search_naukri(
    *,
    user_id: str,
    token_row: dict,
    query: str,
    locations: list[str],
    experience_years: int,
    page: int,
    results_per_page: int,
    freshness_days: int,
    warnings: list[str],
) -> list:
    from portals.naukri.auth import NaukriAuthClient
    from portals.naukri.jobs import NaukriJobClient
    from portals.naukri.session import get_valid_naukri_auth

    # Keyword search works on Naukri's public endpoint (nkparam-based, no token).
    # When the user has a durable Naukri login we use it so the same client can
    # also pull personalized recommendations and submit applies; the token is
    # silently refreshed from stored credentials when it has expired.
    auth = await asyncio.to_thread(get_valid_naukri_auth, user_id, token_row)
    authenticated = auth is not None
    if auth is None:
        auth = NaukriAuthClient()
    client = NaukriJobClient(auth)

    jobs = []
    # Personalized recommendations are profile-based, so only fold them into a
    # "find from profile" run (no explicit keyword) and only on the first page.
    if authenticated and not query.strip() and page == 1:
        try:
            recommended = await asyncio.to_thread(client.get_recommended_jobs)
            jobs.extend(recommended)
        except Exception as exc:
            logger.info("Naukri recommended jobs unavailable: %s", _safe_error(exc))

    for location in locations:
        try:
            page_jobs = await client.search_jobs(
                keyword=query,
                location=location,
                experience=experience_years,
                page=page,
                results_per_page=results_per_page,
                freshness_days=freshness_days,
            )
            jobs.extend(page_jobs)
        except Exception as exc:
            if _exception_status_code(exc) == 401:
                warning = "Naukri public search returned 401. Try again later or open Naukri directly from the portal."
                warnings.append(warning)
                logger.warning(warning)
                continue
            warning = f"Naukri search failed for {query} / {location or 'any location'} page {page}: {_safe_error(exc)}"
            warnings.append(warning)
            logger.warning(warning)
    return jobs


def _get_preferences(db, user_id: str) -> dict:
    result = db.table("preferences").select("*").eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    return result.data or {}


def _get_latest_resume(db, user_id: str) -> dict | None:
    result = db.table("resumes").select("parsed_data, raw_text").eq(
        "user_id",
        user_id,
    ).order("created_at", desc=True).limit(1).maybe_single().execute() or NULL_RESULT
    if not result.data or not result.data.get("parsed_data"):
        return None
    return result.data["parsed_data"]


def _get_portal_tokens(db, user_id: str) -> dict[str, dict]:
    result = db.table("portal_tokens").select("*").eq("user_id", user_id).execute()
    return {row["portal"]: row for row in (result.data or []) if row.get("portal")}


def _validate_connected_portals(portals: list[str], tokens: dict[str, dict]) -> None:
    for portal in portals:
        if portal == "naukri":
            continue


def _save_preferences_from_search(db, user_id: str, request: dict) -> None:
    try:
        payload = {
            "user_id": user_id,
            "job_titles": [request["query"]],
            "locations": request["locations"],
            "skills": request["skills"],
            "work_type": request["work_type"],
            "experience_years": request["experience_years"],
            "updated_at": _now(),
        }
        try:
            db.table("preferences").upsert(payload, on_conflict="user_id").execute()
        except Exception as exc:
            if "skills" not in str(exc).lower():
                raise
            payload.pop("skills", None)
            db.table("preferences").upsert(payload, on_conflict="user_id").execute()
    except Exception as exc:
        logger.warning("Could not save manual search as preferences for %s: %s", user_id, exc)


def _create_search_run(db, user_id: str, request: dict) -> str:
    try:
        result = db.table("manual_search_runs").insert({
            "user_id": user_id,
            "query": request["query"],
            "locations": request["locations"],
            "portals": request["portals"],
            "experience_years": request["experience_years"],
            "min_score": request["min_score"],
            "max_pages": request["max_pages"],
            "status": "running",
        }).execute()
        if result.data:
            return str(result.data[0].get("id") or "")
    except Exception as exc:
        logger.info("manual_search_runs table unavailable; continuing without run row: %s", exc)
    return ""


def _update_search_run(db, run_id: str, run: dict, *, warnings: list[str]) -> None:
    if not run_id:
        return
    try:
        db.table("manual_search_runs").update({
            "status": "completed",
            "fetched_count": run["fetched_count"],
            "new_jobs_count": run["new_jobs_count"],
            "scored_count": run["scored_count"],
            "saved_matches_count": run["saved_matches_count"],
            "warnings": warnings,
            "finished_at": _now(),
        }).eq("id", run_id).execute()
    except Exception as exc:
        logger.info("Could not update manual search run %s: %s", run_id, exc)


def _mark_search_failed(db, run_id: str, error: str, warnings: list[str]) -> None:
    if not run_id:
        return
    try:
        db.table("manual_search_runs").update({
            "status": "failed",
            "error": error,
            "warnings": warnings,
            "finished_at": _now(),
        }).eq("id", run_id).execute()
    except Exception as exc:
        logger.info("Could not mark manual search run %s failed: %s", run_id, exc)


def _get_existing_applied_job_ids(db, user_id: str) -> set[str]:
    try:
        result = db.table("applications").select("status, jobs(portal, job_id)").eq(
            "user_id",
            user_id,
        ).execute()
    except Exception as exc:
        logger.info("Could not load applied jobs for manual-search dedupe: %s", exc)
        return set()

    keys: set[str] = set()
    for row in result.data or []:
        if (row.get("status") or "") not in {"applied", "viewed", "interview", "offer"}:
            continue
        job = row.get("jobs") or {}
        portal = job.get("portal")
        job_id = job.get("job_id")
        if portal and job_id:
            keys.add(f"{portal}:{job_id}")
    return keys


def _filter_jobs_by_preferences(jobs: list, request: dict, warnings: list[str]) -> list:
    filtered = _drop_avoided_companies(jobs, request.get("avoid_companies") or [])
    if len(filtered) < len(jobs):
        warnings.append(f"Skipped {len(jobs) - len(filtered)} jobs from avoided companies.")

    skill_terms = request.get("skills") or []
    if skill_terms:
        skill_matches = [job for job in filtered if _job_contains_any(job, skill_terms)]
        if skill_matches:
            if len(skill_matches) < len(filtered):
                warnings.append(
                    f"{len(skill_matches)} fetched jobs matched saved profile skills; all fetched jobs remain visible."
                )
        else:
            warnings.append("No fetched jobs matched saved skills exactly; showing all search results.")

    work_types = request.get("work_type") or []
    if work_types:
        work_type_matches = [job for job in filtered if _job_matches_work_type(job, work_types)]
        if work_type_matches:
            if len(work_type_matches) < len(filtered):
                warnings.append(f"{len(work_type_matches)} fetched jobs matched saved work-type preferences; all fetched jobs remain visible.")
        else:
            warnings.append("No fetched jobs clearly matched saved work type; showing all search results.")

    return filtered


def _scoring_context(request: dict, resume: dict | None, *, fast: bool = False) -> dict:
    resume_available = _has_resume_evidence(resume)
    preference_terms = _preference_terms_from_request(request)
    if resume_available:
        profile = {**(resume or {}), "_scoring_mode": "manual_search" if fast else "resume"}
    else:
        profile_terms = preference_terms or _split_search_terms(request.get("query") or DEFAULT_QUERY)
        profile = {
            "_scoring_mode": "search",
            "name": "",
            "current_role": request.get("query") or DEFAULT_QUERY,
            "total_experience_years": request.get("experience_years") or 0,
            "skills": profile_terms,
            "technical_skills": profile_terms,
            "soft_skills": [],
            "education": "",
            "summary": "Search-only ranking profile generated from the current query and saved preferences.",
        }

    return {
        "profile": profile,
        "resume_available": resume_available,
        "preferences_available": bool(preference_terms),
        "preference_terms": preference_terms,
    }


def _has_resume_evidence(resume: dict | None) -> bool:
    if not isinstance(resume, dict) or not resume:
        return False
    values = [
        resume.get("current_role"),
        resume.get("summary"),
        resume.get("skills"),
        resume.get("technical_skills"),
        resume.get("total_experience_years"),
    ]
    return any(bool(value) for value in values)


def _preference_terms_from_request(request: dict) -> list[str]:
    terms: list[str] = []
    terms.extend(_string_list(request.get("skills")))
    terms.extend(_split_search_terms(request.get("query") or ""))
    terms.extend(_string_list(request.get("work_type")))
    return _dedupe_terms(terms)


def _preference_terms_from_prefs(prefs: dict) -> list[str]:
    terms: list[str] = []
    terms.extend(_string_list(prefs.get("skills")))
    for title in _string_list(prefs.get("job_titles")):
        terms.extend(_split_search_terms(title))
    terms.extend(_string_list(prefs.get("work_type")))
    return _dedupe_terms(terms)


def _recommendation_context(
    *,
    job,
    score: int,
    preference_terms: list[str],
    resume_available: bool,
    min_score: int,
) -> dict:
    preference_matches = [
        term for term in preference_terms
        if _job_contains_any(job, [term])
    ]
    preference_score = round((len(preference_matches) / len(preference_terms)) * 100) if preference_terms else 0
    preferences_available = bool(preference_terms)

    if resume_available and preferences_available and score >= min_score and preference_matches:
        basis = "resume_and_preferences"
        label = "Resume + profile match"
    elif resume_available and score >= min_score:
        basis = "resume"
        label = "Resume match"
    elif preferences_available and preference_score >= 50:
        basis = "preferences"
        label = "Profile match"
    else:
        basis = "search"
        label = "Search result"

    recommended = basis != "search"
    return {
        "basis": basis,
        "label": label,
        "recommended": recommended,
        "resume_available": resume_available,
        "preferences_available": preferences_available,
        "preference_score": preference_score,
        "preference_matched_terms": preference_matches[:10],
        "min_score": min_score,
    }


def _split_search_terms(value: str) -> list[str]:
    stop_words = {"and", "or", "the", "for", "with", "jobs", "job", "role", "roles"}
    return [
        item for item in str(value or "").replace(",", " ").split()
        if len(item.strip()) > 2 and item.strip().lower() not in stop_words
    ]


def _dedupe_terms(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        label = str(value).strip()
        key = label.lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(label)
    return result


def _drop_avoided_companies(jobs: list, avoid_companies: list[str]) -> list:
    if not avoid_companies:
        return jobs
    avoid_terms = [item.lower() for item in avoid_companies if item]
    if not avoid_terms:
        return jobs
    return [
        job for job in jobs
        if not any(term in str(getattr(job, "company", "")).lower() for term in avoid_terms)
    ]


def _job_contains_any(job, terms: list[str]) -> bool:
    haystack = _job_search_text(job)
    return any(term.lower() in haystack for term in terms if term)


def _job_matches_work_type(job, work_types: list[str]) -> bool:
    haystack = _job_search_text(job)
    normalized = {item.lower().replace("-", " ").strip() for item in work_types if item}
    if not normalized:
        return True

    remote_markers = ("remote", "work from home", "wfh")
    hybrid_markers = ("hybrid",)
    onsite_markers = ("onsite", "on site", "office")

    if "remote" in normalized and any(marker in haystack for marker in remote_markers):
        return True
    if "hybrid" in normalized and any(marker in haystack for marker in hybrid_markers):
        return True
    if ("onsite" in normalized or "on site" in normalized) and any(marker in haystack for marker in onsite_markers):
        return True
    return False


def _job_search_text(job) -> str:
    if isinstance(job, dict):
        values = [
            job.get("title", ""),
            job.get("company", ""),
            job.get("location", ""),
            job.get("description", ""),
            " ".join(job.get("tags", []) or []),
            str(job.get("portal_metadata", {}) or {}),
        ]
    else:
        values = [
            getattr(job, "title", ""),
            getattr(job, "company", ""),
            getattr(job, "location", ""),
            getattr(job, "description", ""),
            " ".join(getattr(job, "tags", []) or []),
            str(getattr(job, "portal_metadata", {}) or {}),
        ]
    return " ".join(str(value) for value in values if value).lower()


def _unique_jobs(jobs: list) -> list:
    seen: set[str] = set()
    unique = []
    for job in jobs:
        key = _job_key(job)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(job)
    return unique


def _count_recommended(matches: list[dict], min_score: int) -> int:
    total = 0
    for match in matches:
        context = match.get("recommendation_context") or {}
        if "recommended" in context:
            if context.get("recommended"):
                total += 1
            continue
        try:
            score = int(match.get("match_score", 0))
        except (TypeError, ValueError):
            score = 0
        if score >= min_score:
            total += 1
    return total


def _job_key(job) -> str:
    portal = getattr(job, "portal", "")
    job_id = getattr(job, "job_id", "")
    return f"{portal}:{job_id}" if portal and job_id else ""


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _int_value(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _exception_status_code(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    return int(status_code) if isinstance(status_code, int) else None


def _safe_error(exc: Exception) -> str:
    text = str(exc) or exc.__class__.__name__
    return text[:300]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
