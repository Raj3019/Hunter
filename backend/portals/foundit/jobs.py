from typing import List

from portals.naukri.jobs import Job

FOUNDIT_BASE = "https://www.foundit.in"
SEARCH_URL = f"{FOUNDIT_BASE}/raven/api/public/search/v2/jobs"
APPLY_URL = f"{FOUNDIT_BASE}/falcon/api/users/v9/jobs/apply"


class FounditJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def search_jobs(
        self, keyword: str, location: str = "",
        experience: int = 0, page: int = 0
    ) -> List[Job]:
        params = {
            "keyword": keyword,
            "location": location,
            "experienceRanges": f"{experience}~{experience + 2}",
            "pageNo": page,
            "pageSize": 20,
            "sort": 1,
        }
        response = self.session.get(SEARCH_URL, params=params)
        response.raise_for_status()
        return self._parse_jobs(response.json())

    def apply_job(self, job: Job) -> dict:
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
                apply_link=(
                    item.get("applyLink") or
                    item.get("applyUrl") or
                    item.get("jdLink") or
                    item.get("jdUrl") or
                    item.get("redirectUrl") or
                    item.get("jobUrl") or
                    ""
                ),
                description=item.get("jobDescription") or item.get("description") or "",
                portal="foundit",
                tags=tags,
            ))
        return jobs

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
