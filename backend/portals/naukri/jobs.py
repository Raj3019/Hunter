from dataclasses import dataclass, field
from datetime import datetime
from typing import List
from requests.exceptions import JSONDecodeError

from .nkparam import generate_nkparam

RECOMMENDED_JOBS_URL = "https://www.naukri.com/jobapi/v2/search/recom-jobs"
JOB_SEARCH_URL = "https://www.naukri.com/jobapi/v3/search"
APPLY_JOB_URL = "https://www.naukri.com/cloudgateway-workflow/workflow-services/apply-workflow/v1/apply"


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
        )
        response.raise_for_status()
        return self._parse_jobs(self._json_response(response, "recommended jobs"))

    async def search_jobs(
        self, keyword: str, location: str = "",
        experience: int = 0, page: int = 1
    ) -> List[Job]:
        seo_key = self._build_seo_key(keyword, location, page)
        params = {
            "noOfResults": 20,
            "urlType": "search_by_keyword",
            "searchType": "adv",
            "keyword": keyword,
            "k": keyword,
            "location": location,
            "experience": experience,
            "pageNo": page,
            "jobAge": 3,
            "nignbevent_src": "jobsearchDeskGNB",
            "seoKey": seo_key,
            "src": "jobsearchDesk",
            "latLong": "",
        }
        response = self.session.get(JOB_SEARCH_URL, params=params, headers=self._search_headers())
        if response.status_code == 403:
            raise RuntimeError("Naukri search failed with 403 - nkparam is likely invalid or expired")
        if response.status_code == 406:
            raise RuntimeError(f"Naukri search validation failed with 406. Response: {response.text[:500]}")
        response.raise_for_status()
        return self._parse_jobs(self._json_response(response, "job search"))

    def apply_job(self, job: Job) -> dict:
        if job.has_questionnaire:
            return {"success": False, "reason": f"Questionnaire required - skip: {job.title}"}

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
        response = self.session.post(APPLY_JOB_URL, headers=headers, json=payload)
        response.raise_for_status()

        return self._json_response(response, "apply")

    def _parse_jobs(self, data: dict) -> List[Job]:
        jobs = []
        items = data.get("jobDetails") or data.get("jobs") or []
        for item in items:
            raw_tags = item.get("tagsAndSkills", "")
            tags = [t.strip() for t in raw_tags.split(",") if t.strip()] if raw_tags else []
            jobs.append(Job(
                job_id=str(item.get("jobId", "")),
                title=item.get("title", ""),
                company=item.get("companyName", ""),
                location=self._placeholder(item, "location") or item.get("location", ""),
                experience=self._placeholder(item, "experience") or item.get("experienceText", "") or item.get("experience", ""),
                salary=self._placeholder(item, "salary") or item.get("salaryDetail", "") or item.get("salary", "Not disclosed"),
                posted_date=item.get("footerPlaceholderLabel", "") or item.get("createdDate", "") or item.get("postedDate", ""),
                apply_link=item.get("jdURL", ""),
                description=item.get("jobDescription", ""),
                tags=tags,
            ))
        return jobs

    def _placeholder(self, item: dict, placeholder_type: str) -> str:
        for placeholder in item.get("placeholders", []):
            if placeholder.get("type") == placeholder_type:
                return placeholder.get("label", "")
        return ""

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
