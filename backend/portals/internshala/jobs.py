from typing import List

from bs4 import BeautifulSoup

from portals.naukri.jobs import Job

INTERNSHALA_BASE = "https://internshala.com"


class InternshalaJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def search_internships(self, keyword: str = "", location: str = "") -> List[Job]:
        url = f"{INTERNSHALA_BASE}/internships/ajax"
        params = {}
        if keyword:
            params["search_po"] = keyword
        if location:
            params["location_po"] = location

        response = self.session.get(url, params=params)
        response.raise_for_status()
        return self._parse_response(response, job_type="internship")

    def search_jobs(self, keyword: str = "", location: str = "") -> List[Job]:
        url = f"{INTERNSHALA_BASE}/jobs/ajax"
        params = {}
        if keyword:
            params["search_po"] = keyword
        if location:
            params["location_po"] = location

        response = self.session.get(url, params=params)
        response.raise_for_status()
        return self._parse_response(response, job_type="job")

    def _parse_response(self, response, job_type: str) -> List[Job]:
        try:
            return self._parse(response.json(), job_type=job_type)
        except ValueError:
            return self._parse_html(response.text, job_type=job_type)

    def _parse(self, data: dict, job_type: str) -> List[Job]:
        jobs = []
        items_raw = (
            data.get("internships_meta") or
            data.get("jobs_meta") or
            data.get("internships") or
            data.get("jobs") or
            {}
        )

        items = items_raw.values() if isinstance(items_raw, dict) else items_raw

        for item in items:
            stipend_data = item.get("stipend", {})
            salary = (
                stipend_data.get("salary") if isinstance(stipend_data, dict)
                else str(stipend_data)
            ) or "Unpaid"

            location_names = item.get("location_names", [])
            location = location_names[0] if location_names else item.get("work_from_home", False) and "Remote" or ""

            skills = item.get("skills", [])
            if isinstance(skills, str):
                skills = [s.strip() for s in skills.split(",") if s.strip()]

            jobs.append(Job(
                job_id=str(item.get("id", "")),
                title=item.get("profile_name", "") or item.get("title", ""),
                company=item.get("company_name", ""),
                location=location,
                experience="Fresher" if job_type == "internship" else item.get("experience", ""),
                salary=salary,
                posted_date=item.get("start_date", "") or item.get("posted_on", ""),
                apply_link=f"https://internshala.com{item.get('application_url', '')}",
                description=item.get("other_details", "") or item.get("job_description", ""),
                portal="internshala",
                tags=skills,
            ))
        return jobs

    def _parse_html(self, html: str, job_type: str) -> List[Job]:
        soup = BeautifulSoup(html, "html.parser")
        jobs = []

        for card in soup.select(".individual_internship"):
            title_link = card.select_one("a.job-title-href")
            if not title_link:
                continue

            job_id = (
                card.get("internshipid") or
                card.get("data-internship_id") or
                card.get("data-job_id") or
                ""
            )
            href = title_link.get("href", "")
            apply_link = href if href.startswith("http") else f"{INTERNSHALA_BASE}{href}"

            company = self._text(card, ".company-name") or self._text(card, ".company_name")
            company = company.replace("Actively hiring", "").strip()

            locations = [loc.get_text(" ", strip=True) for loc in card.select(".locations a")]
            location = locations[0] if locations else ("Remote" if "work from home" in card.get_text(" ", strip=True).lower() else "")

            salary = self._text(card, ".stipend") or self._extract_salary(card.get_text(" ", strip=True))
            experience = "Fresher" if job_type == "internship" else self._extract_experience(card.get_text(" ", strip=True))

            jobs.append(Job(
                job_id=str(job_id),
                title=title_link.get_text(" ", strip=True),
                company=company,
                location=location,
                experience=experience,
                salary=salary or "Unpaid",
                posted_date=self._text(card, ".status-success") or "",
                apply_link=apply_link,
                description=card.get_text(" ", strip=True),
                portal="internshala",
                tags=self._extract_skills(card),
            ))

        return jobs

    @staticmethod
    def _text(card, selector: str) -> str:
        element = card.select_one(selector)
        return element.get_text(" ", strip=True) if element else ""

    @staticmethod
    def _extract_salary(text: str) -> str:
        marker = "year" if "/year" in text else "month" if "/month" in text else ""
        if not marker:
            return ""
        marker_text = f"/{marker}"
        marker_index = text.find(marker_text)
        start = max(text.rfind("Rs.", 0, marker_index), text.rfind("\u20b9", 0, marker_index))
        if start == -1:
            return ""
        return text[start:marker_index + len(marker_text)].strip()

    @staticmethod
    def _extract_experience(text: str) -> str:
        marker = " year(s)"
        marker_index = text.find(marker)
        if marker_index == -1:
            return ""
        start = text.rfind(" ", 0, marker_index)
        return f"{text[start:marker_index].strip()} years"

    @staticmethod
    def _extract_skills(card) -> List[str]:
        selectors = [
            ".round_tabs_container .round_tabs",
            ".skills .round_tabs",
            ".skill",
        ]
        skills = []
        for selector in selectors:
            skills.extend(
                item.get_text(" ", strip=True)
                for item in card.select(selector)
                if item.get_text(" ", strip=True)
            )
        return list(dict.fromkeys(skills))
