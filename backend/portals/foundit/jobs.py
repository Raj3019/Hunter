import base64
from typing import List

from core.retry import with_retry
from portals.naukri.jobs import Job

FOUNDIT_BASE = "https://www.foundit.in"
SEARCH_URL = f"{FOUNDIT_BASE}/raven/api/public/search/v2/jobs"
APPLY_URL = f"{FOUNDIT_BASE}/falcon/api/users/v9/jobs/apply"

# Applied-jobs ("My Applies") endpoint — read-only, authenticated. Reverse-
# engineered from Foundit's own frontend (the ``appliedJobs`` URL in their JS
# bundle). The falcon gateway needs three things the public search does not:
#   1. The RAW JWT in Authorization — Foundit stores the token base64-encoded
#      (``base64(JWT + "::bearer:<ts>:")``); falcon rejects that with
#      "JWT must have 3 tokens" and wants the decoded 3-part JWT.
#   2. The numeric profile id in the ``MSUID`` cookie — otherwise the profile
#      resolves to null ("PROFILE_NOT_FOUND ... for null").
#   3. The ``x-source-site-context`` header (``rexmonster`` for foundit.in).
# The server caps the page at 10 rows regardless of pageSize, so we page through
# ``meta.paging.total``.
APPLIED_HISTORY_URL = f"{FOUNDIT_BASE}/falcon/api/users/v2/jobs/applied"
# Per-application status timeline (recruiter-side: viewed/shortlisted/…). Takes an
# ``applicationId`` and is empty until a recruiter acts on the application.
APPLICATION_STATUS_URL = f"{FOUNDIT_BASE}/falcon/api/users/v1/application-history"
RIOME_URL = f"{FOUNDIT_BASE}/seeker-profile/api/rioMe"
FOUNDIT_SITE_CONTEXT = "rexmonster"


def _decode_falcon_jwt(raw_token: str) -> str:
    """``base64(JWT + '::bearer:<ts>:')`` -> the raw 3-part JWT falcon expects."""
    if not raw_token:
        return ""
    try:
        decoded = base64.b64decode(raw_token + "=" * (-len(raw_token) % 4)).decode("utf-8", "ignore")
    except Exception:
        return raw_token
    jwt = decoded.split("::")[0].strip()
    return jwt if jwt.count(".") == 2 else raw_token


class FounditJobClient:
    def __init__(self, auth):
        self.auth = auth
        self.session = auth.session
        self._msuid = None

    @with_retry(label="foundit-search")
    def search_jobs(
        self, keyword: str, location: str = "",
        experience: int = 0, page: int = 0, results_per_page: int = 20,
    ) -> List[Job]:
        # Foundit's current public search uses `query`/`locations` (not
        # `keyword`/`location`); pageNo is 0-indexed. No login required.
        params = {
            "query": keyword,
            "locations": location,
            "experienceRanges": f"{experience}~{experience + 2}",
            "pageNo": page,
            "pageSize": results_per_page,
            "sort": 1,
        }
        response = self.session.get(SEARCH_URL, params=params)
        response.raise_for_status()
        return self._parse_jobs(response.json())

    def _resolve_msuid(self) -> str:
        """The numeric profile id falcon needs in the MSUID cookie (cached)."""
        if self._msuid:
            return self._msuid
        response = self.session.get(RIOME_URL, timeout=20)
        response.raise_for_status()
        self._msuid = str((response.json() or {}).get("id") or "")
        return self._msuid

    def _prepare_falcon_request(self) -> dict:
        """Set the MSSOAT/MSUID cookies falcon needs and return its headers.

        Falcon wants the raw 3-part JWT in Authorization (the stored token is
        base64-encoded), the numeric profile id in the MSUID cookie, and the
        site-context header — see the module docstring on ``APPLIED_HISTORY_URL``.
        """
        raw_token = self.auth.bearer_token or self.session.cookies.get("MSSOAT") or ""
        if raw_token:
            self.session.cookies.set("MSSOAT", raw_token, domain="www.foundit.in")
        self.session.cookies.set("MSUID", self._resolve_msuid(), domain="www.foundit.in")
        return {
            "Authorization": f"Bearer {_decode_falcon_jwt(raw_token)}",
            "x-source-site-context": FOUNDIT_SITE_CONTEXT,
            "x-language-code": "EN",
        }

    @with_retry(label="foundit-history")
    def get_application_history(self, max_pages: int = 20) -> list:
        """Read-only: the jobs the user has applied to on Foundit ("My Applies").

        Returns a normalized list of ``{job_id, status_value, title, company,
        application_id}``. Used to auto-detect applies without performing any
        action on the account. The list endpoint carries no recruiter-side status,
        so every row starts at "Applied"; the reconcile enriches matched rows to
        viewed/interview via ``get_application_status(application_id)``.
        """
        headers = self._prepare_falcon_request()
        records: list = []
        page = 1
        while page <= max_pages:
            response = self.session.get(
                APPLIED_HISTORY_URL,
                params={"pageNumber": page, "pageSize": 50},
                headers=headers,
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json() or {}
            batch = self._parse_application_history(payload)
            records.extend(batch)
            total = ((payload.get("meta") or {}).get("paging") or {}).get("total")
            if not batch or (isinstance(total, int) and len(records) >= total):
                break
            page += 1
        return records

    @with_retry(label="foundit-app-status")
    def get_application_status(self, application_id) -> str:
        """Latest recruiter-side status for one application, or "" if none yet.

        Reads ``/users/v1/application-history?applicationId=X`` (per-application
        timeline). Most applications have an empty timeline until a recruiter acts,
        in which case this returns "" and the caller keeps the default "Applied".
        """
        if not application_id:
            return ""
        headers = self._prepare_falcon_request()
        response = self.session.get(
            APPLICATION_STATUS_URL,
            params={"applicationId": application_id},
            headers=headers,
            timeout=20,
        )
        response.raise_for_status()
        events = (response.json() or {}).get("applicationHistory") or []
        return self._latest_status(events)

    @staticmethod
    def _latest_status(events) -> str:
        """Pull a human status label from the most recent timeline event.

        The populated shape isn't documented (all sampled accounts had empty
        timelines), so this probes the common status-ish keys defensively and
        falls back to "" — which keeps the safe "Applied" default.
        """
        if not isinstance(events, list) or not events:
            return ""
        latest = events[-1]
        if not isinstance(latest, dict):
            return str(latest)
        for key in ("status", "statusValue", "stage", "label", "name", "title", "action", "event", "type"):
            value = latest.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                for inner in ("label", "name", "value", "text"):
                    if isinstance(value.get(inner), str) and value[inner].strip():
                        return value[inner].strip()
        return ""

    def _parse_application_history(self, data: dict) -> list:
        """Normalize the applied-jobs response into apply records.

        Shape (per ``/falcon/api/users/v2/jobs/applied``):
        ``{"data": [{"applicationData": {"applicationId"}, "jobDetails": {"jobId",
        "title", "company": {"name"}}}], "meta": {"paging": {"total"}}}``.
        Returns ``[{job_id, status_value, title, company, application_id}, ...]``.
        """
        items = data.get("data")
        if not isinstance(items, list):
            return []

        records = []
        for item in items:
            if not isinstance(item, dict):
                continue
            details = item.get("jobDetails") or {}
            job_id = str(details.get("jobId") or details.get("id") or "")
            if not job_id:
                continue
            company = details.get("company")
            company_name = company.get("name") if isinstance(company, dict) else (company or "")
            records.append({
                "job_id": job_id,
                # Starts at "Applied"; reconcile may enrich to viewed/interview.
                "status_value": "Applied",
                "title": details.get("title") or "",
                "company": company_name or "",
                "application_id": (item.get("applicationData") or {}).get("applicationId"),
            })
        return records

    def apply_job(self, job: Job) -> dict:
        if (job.apply_method or "unknown").lower() == "external":
            external_url = job.external_apply_url or job.apply_link
            return {
                "success": False,
                "external_pending": True,
                "apply_method": "external",
                "reason": "This job must be completed on the company website or source job page.",
                "external_apply_url": external_url,
                "portal_response": {
                    "source": "foundit",
                    "apply_method": job.apply_method or "unknown",
                    "portal_metadata": job.portal_metadata,
                },
            }

        response = self.session.post(APPLY_URL, json={"jobId": job.job_id})
        return response.json()

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = (
            data.get("jobSearchResponse", {}).get("data", []) or
            data.get("jobs", []) or
            data.get("jobDetails", []) or
            data.get("data", [])
        )
        if isinstance(items, dict):
            items = list(items.values())

        for item in items:
            company_data = item.get("company", {})
            company_name = (
                company_data.get("name") or company_data.get("companyName") if isinstance(company_data, dict)
                else str(company_data)
            )
            if not company_name:
                company_name = (
                    item.get("companyName") or
                    item.get("company") or
                    item.get("recruiterCompanyName") or
                    ""
                )

            location_raw = (
                item.get("location") or
                item.get("locations") or
                item.get("jobLocation") or
                item.get("city") or
                ""
            )
            location_text = self._join_value(location_raw)

            experience_text = self._range_text(
                item.get("minimumExperience"),
                item.get("maximumExperience"),
                "yrs",
            ) or self._join_value(item.get("experience") or item.get("experienceText") or "")
            salary_text = self._range_text(
                item.get("minimumSalary"),
                item.get("maximumSalary"),
                "",
            )
            salary_raw = item.get("salary") or item.get("salaryDetail") or item.get("salaryRange")
            skills_raw = item.get("keySkills") or item.get("skills") or item.get("skillSet") or []
            tags = self._parse_tags(skills_raw)
            # Always open the canonical Foundit job page (jdUrl). The raw
            # applyUrl/redirectUrl points at the aggregated *source* listing
            # (e.g. an often-expired LinkedIn job), so we never open it directly —
            # the Foundit page handles Quick Apply or a fresh redirect.
            jd_path = item.get("jdUrl") or ""
            if jd_path.startswith("/"):
                apply_link = FOUNDIT_BASE + jd_path
            elif jd_path.startswith("http"):
                apply_link = jd_path
            else:
                apply_link = ""
            portal_metadata = self._apply_metadata(item)
            apply_method = self._classify_apply_method(portal_metadata)
            external_apply_url = ""

            jobs.append(Job(
                job_id=str(item.get("jobId") or item.get("id") or item.get("kiwiJobId") or ""),
                title=item.get("designation") or item.get("title") or item.get("jobTitle") or "",
                company=self._join_value(company_name),
                location=location_text,
                experience=experience_text,
                salary=salary_text or self._join_value(salary_raw) or "Not disclosed",
                posted_date=(
                    item.get("postedDate") or
                    item.get("postedAt") or
                    item.get("modifiedOn") or
                    item.get("createdAt") or
                    item.get("updatedAt") or
                    ""
                ),
                apply_link=apply_link,
                description=item.get("jobDescription") or item.get("description") or "",
                portal="foundit",
                tags=tags,
                apply_method=apply_method,
                external_apply_url=external_apply_url,
                portal_metadata=portal_metadata,
            ))
        return jobs

    def _apply_metadata(self, item: dict) -> dict:
        keys = {
            "applyType",
            "applyMode",
            "applyMethod",
            "applyUrl",
            "redirectUrl",
            "externalApplyUrl",
            "isExternalApply",
            "quickApplyJob",
            "quickJob",
            "quickApply",
            "directApply",
            "easyApply",
            "jobSource",
        }
        return {
            key: item.get(key)
            for key in keys
            if key in item and item.get(key) not in (None, "")
        }

    def _classify_apply_method(self, metadata: dict) -> str:
        # Quick Apply = applies natively on Foundit; otherwise it redirects to the
        # source/company site (external).
        if any(self._is_truthy(metadata.get(k)) for k in (
            "quickApplyJob", "quickJob", "quickApply", "directApply", "easyApply",
        )):
            return "native"
        if (
            metadata.get("redirectUrl") or
            metadata.get("applyUrl") or
            self._is_truthy(metadata.get("isExternalApply"))
        ):
            return "external"
        return "unknown"

    def _external_apply_url(self, item: dict) -> str:
        for key in ("externalApplyUrl", "applyUrl", "applyLink", "redirectUrl", "jobUrl"):
            value = item.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        return ""

    @staticmethod
    def _join_value(value) -> str:
        if value is None:
            return ""
        if isinstance(value, list):
            return ", ".join(FounditJobClient._join_value(v) for v in value if v)
        if isinstance(value, dict):
            return (
                value.get("city") or
                value.get("name") or
                value.get("state") or
                value.get("country") or
                value.get("label") or
                value.get("value") or
                value.get("text") or
                ", ".join(str(v) for v in value.values() if v)
            )
        return str(value)

    @staticmethod
    def _is_truthy(value) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return value == 1
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y"}
        return False

    @staticmethod
    def _range_text(minimum, maximum, suffix: str) -> str:
        minimum = FounditJobClient._range_value(minimum)
        maximum = FounditJobClient._range_value(maximum)
        if minimum is None and maximum is None:
            return ""
        if minimum is None:
            return f"Up to {maximum} {suffix}".strip()
        if maximum is None:
            return f"{minimum}+ {suffix}".strip()
        return f"{minimum}-{maximum} {suffix}".strip()

    @staticmethod
    def _range_value(value):
        if value is None:
            return None
        if isinstance(value, dict):
            value = (
                value.get("years") if value.get("years") is not None else
                value.get("absoluteValue") if value.get("absoluteValue") else
                value.get("value")
            )
        if value in ("", 0, "0"):
            return None
        return value

    @staticmethod
    def _parse_tags(value) -> List[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [s.strip() for s in value.split(",") if s.strip()]
        if isinstance(value, list):
            return [
                tag
                for item in value
                for tag in FounditJobClient._parse_tags(
                    item.get("name") or item.get("text") or item.get("value") if isinstance(item, dict) else item
                )
            ]
        if isinstance(value, dict):
            return FounditJobClient._parse_tags(
                value.get("name") or value.get("text") or value.get("value") or list(value.values())
            )
        return [str(value)]
