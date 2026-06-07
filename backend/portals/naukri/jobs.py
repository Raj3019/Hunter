from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, List
from requests.exceptions import JSONDecodeError

from .nkparam import generate_nkparam

RECOMMENDED_JOBS_URL = "https://www.naukri.com/jobapi/v2/search/recom-jobs"
JOB_SEARCH_URL = "https://www.naukri.com/jobapi/v3/search"
APPLY_JOB_URL = "https://www.naukri.com/cloudgateway-workflow/workflow-services/apply-workflow/v1/apply"
NAUKRI_REQUEST_TIMEOUT_SECONDS = 30


@dataclass
class Job:
    job_id: str
    title: str
    company: str
    location: str
    experience: str
    salary: str
    posted_date: str
    apply_link: str
    description: str
    portal: str = "naukri"
    tags: List[str] = field(default_factory=list)
    has_questionnaire: bool = False
    is_workday: bool = False
    is_taleo: bool = False
    apply_method: str = "unknown"
    external_apply_url: str = ""
    portal_metadata: dict = field(default_factory=dict)


class NaukriJobClient:
    def __init__(self, auth):
        self.auth = auth
        self.session = auth.session

    def _cluster_dates(self) -> dict:
        now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
        return {
            "apply": now,
            "preference": now,
            "profile": now,
            "similar_jobs": now,
        }

    def _build_seo_key(self, keyword: str, location: str, page: int) -> str:
        kw_slug = (
            keyword.strip().lower()
            .replace(".", "-dot-")
            .replace(" ", "-")
            .replace("+", "-")
            .strip("-")
        )
        if location.strip():
            loc_slug = location.strip().lower().replace(" ", "-")
            return f"{kw_slug}-jobs-in-{loc_slug}-{page}"
        return f"{kw_slug}-jobs-{page}"

    def _search_headers(self) -> dict:
        headers = self.auth._build_headers(auth=False)
        referer = "https://www.naukri.com/"
        headers.update({
            "authority": "www.naukri.com",
            "accept": "application/json",
            "accept-encoding": "gzip, deflate",
            "accept-language": "en-US,en;q=0.9",
            "appid": "109",
            "gid": "LOCATION,INDUSTRY,EDUCATION,FAREA_ROLE",
            "nkparam": generate_nkparam("srp"),
            "referer": referer,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "systemid": "Naukri",
        })
        return headers

    def get_recommended_jobs(self) -> List[Job]:
        response = self.session.post(
            RECOMMENDED_JOBS_URL,
            headers=self.auth._build_headers(auth=True),
            json={
                "clusterId": None,
                "src": "recommClusterApi",
                "clusterSplitDate": self._cluster_dates(),
            },
            timeout=NAUKRI_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return self._parse_jobs(self._json_response(response, "recommended jobs"))

    async def search_jobs(
        self,
        keyword: str,
        location: str = "",
        experience: int = 0,
        page: int = 1,
        results_per_page: int = 20,
        freshness_days: int = 3,
    ) -> List[Job]:
        seo_key = self._build_seo_key(keyword, location, page)
        params = {
            "noOfResults": max(1, min(int(results_per_page or 20), 20)),
            "urlType": "search_by_keyword",
            "searchType": "adv",
            "keyword": keyword,
            "k": keyword,
            "location": location,
            "experience": experience,
            "pageNo": page,
            "jobAge": max(1, min(int(freshness_days or 3), 30)),
            "nignbevent_src": "jobsearchDeskGNB",
            "seoKey": seo_key,
            "src": "jobsearchDesk",
            "latLong": "",
        }
        response = self.session.get(
            JOB_SEARCH_URL,
            params=params,
            headers=self._search_headers(),
            timeout=NAUKRI_REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code == 403:
            raise RuntimeError("Naukri search failed with 403 - nkparam is likely invalid or expired")
        if response.status_code == 406:
            raise RuntimeError(f"Naukri search validation failed with 406. Response: {response.text[:500]}")
        response.raise_for_status()
        return self._parse_jobs(self._json_response(response, "job search"))

    def apply_job(self, job: Job) -> dict:
        if job.has_questionnaire:
            return {"success": False, "reason": f"Questionnaire required - skip: {job.title}"}

        if (job.apply_method or "unknown").lower() == "external":
            external_url = job.external_apply_url or job.apply_link
            return {
                "success": False,
                "external_pending": True,
                "apply_method": "external",
                "reason": "This job must be completed on the company website.",
                "external_apply_url": external_url,
                "portal_response": {
                    "source": "naukri",
                    "apply_method": job.apply_method or "unknown",
                    "portal_metadata": job.portal_metadata,
                },
            }

        sid = datetime.utcnow().strftime("%Y%m%d%H%M%S") + "0000000"
        payload = {
            "strJobsarr": [job.job_id],
            "logstr": f"--srp-1-F-0-1--{sid}-",
            "flowtype": "show",
            "crossdomain": True,
            "jquery": 1,
            "rdxMsgId": "",
            "chatBotSDK": True,
            "mandatory_skills": [],
            "optional_skills": [],
            "applyTypeId": "107",
            "closebtn": "y",
            "applySrc": "srp",
            "sid": sid,
            "mid": "",
        }
        headers = self.auth._build_headers(auth=True)
        headers.update({
            "appid": "121",
            "systemid": "jobseeker",
            "clientid": "d3skt0p",
            "accept": "application/json",
        })
        response = self.session.post(
            APPLY_JOB_URL,
            headers=headers,
            json=payload,
            timeout=NAUKRI_REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code in {401, 403}:
            return {
                "success": False,
                "reason": "Naukri auto-apply is dormant in the MVP. Open the original portal page and confirm the outcome in Tracker.",
                "status_code": response.status_code,
            }
        response.raise_for_status()

        return self._json_response(response, "apply")

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = data.get("jobDetails") or data.get("jobs") or []
        for item in items:
            raw_tags = item.get("tagsAndSkills", "")
            tags = [t.strip() for t in raw_tags.split(",") if t.strip()] if raw_tags else []
            apply_link = item.get("jdURL", "")
            portal_metadata = self._apply_metadata(item)
            apply_method = self._classify_apply_method(item, portal_metadata)
            external_apply_url = self._external_apply_url(item) or (apply_link if apply_method != "native" else "")
            jobs.append(Job(
                job_id=str(item.get("jobId", "")),
                title=item.get("title", ""),
                company=item.get("companyName", ""),
                location=self._placeholder(item, "location") or item.get("location", ""),
                experience=self._placeholder(item, "experience") or item.get("experienceText", "") or item.get("experience", ""),
                salary=self._placeholder(item, "salary") or item.get("salaryDetail", "") or item.get("salary", "Not disclosed"),
                posted_date=item.get("footerPlaceholderLabel", "") or item.get("createdDate", "") or item.get("postedDate", ""),
                apply_link=apply_link,
                description=item.get("jobDescription", ""),
                tags=tags,
                apply_method=apply_method,
                external_apply_url=external_apply_url,
                portal_metadata=portal_metadata,
            ))
        return jobs

    def _placeholder(self, item: dict, placeholder_type: str) -> str:
        for placeholder in item.get("placeholders", []):
            if placeholder.get("type") == placeholder_type:
                return placeholder.get("label", "")
        return ""

    def _apply_metadata(self, item: dict) -> dict:
        keys = {
            "applyType",
            "applyTypeId",
            "applyMode",
            "applyModeId",
            "applyButtonText",
            "applyButtonLabel",
            "applyUrl",
            "applyLink",
            "redirectUrl",
            "externalApplyUrl",
            "companyApplyUrl",
            "isExternalApply",
            "isCompanyApply",
            "easyApply",
            "isEasyApply",
            "hasApply",
            "hasQuestionnaire",
        }
        metadata = {
            key: item.get(key)
            for key in keys
            if key in item and item.get(key) not in (None, "")
        }
        if item.get("applyDetails") and isinstance(item.get("applyDetails"), dict):
            metadata["applyDetails"] = item["applyDetails"]
        return metadata

    def _classify_apply_method(self, item: dict, metadata: dict) -> str:
        combined = " ".join(
            str(value).lower()
            for value in metadata.values()
            if isinstance(value, (str, int, bool))
        )
        external_markers = (
            "external",
            "company site",
            "company website",
            "companyapply",
            "web job",
            "redirect",
        )
        if any(marker in combined for marker in external_markers):
            return "external"

        for key in ("isExternalApply", "isCompanyApply"):
            if self._is_truthy(item.get(key)):
                return "external"

        for key in ("easyApply", "isEasyApply"):
            if self._is_truthy(item.get(key)):
                return "native"

        button_text = str(
            item.get("applyButtonText") or item.get("applyButtonLabel") or ""
        ).lower()
        if button_text in {"apply", "apply now", "apply on naukri"}:
            return "native"

        return "unknown"

    def _external_apply_url(self, item: dict) -> str:
        for key in ("externalApplyUrl", "companyApplyUrl", "applyUrl", "applyLink", "redirectUrl"):
            value = item.get(key)
            if isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        details = item.get("applyDetails")
        if isinstance(details, dict):
            return self._external_apply_url(details)
        return ""

    @staticmethod
    def _is_truthy(value) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, int):
            return value == 1
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "y"}
        return False

    def _json_response(self, response, label: str) -> dict:
        try:
            return response.json()
        except JSONDecodeError as exc:
            content_type = response.headers.get("content-type", "")
            content_encoding = response.headers.get("content-encoding", "")
            preview = response.text[:1000].replace("\n", " ").strip()
            raise RuntimeError(
                f"Naukri {label} returned non-JSON response. "
                f"Status: {response.status_code}. Content-Type: {content_type}. "
                f"Content-Encoding: {content_encoding}. "
                f"URL: {response.url}. Body preview: {preview}"
            ) from exc
