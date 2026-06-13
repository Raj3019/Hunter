import re
from typing import List

from bs4 import BeautifulSoup

from portals.naukri.jobs import Job

INTERNSHALA_BASE = "https://internshala.com"


def _slugify(value: str) -> str:
    """"Python Developer" -> "python-developer" for Internshala's SEO search paths."""
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")


class InternshalaJobClient:
    def __init__(self, auth):
        self.session = auth.session

    def search_internships(self, keyword: str = "", location: str = "") -> List[Job]:
        return self._search_by_path("internships", keyword, location, job_type="internship")

    def search_jobs(self, keyword: str = "", location: str = "") -> List[Job]:
        return self._search_by_path("jobs", keyword, location, job_type="job")

    def _search_by_path(self, section: str, keyword: str, location: str, job_type: str) -> List[Job]:
        # Internshala filters via SEO path segments, NOT query params (the old
        # search_po/location_po params returned unfiltered junk). Free-text
        # keyword search uses the "keywords-" prefix: e.g.
        # /jobs/keywords-react-developer-in-mumbai/ . A bare "<kw>-jobs" path is a
        # fixed category slug and ignores unknown keywords, so it must not be used.
        # The "/ajax/" suffix returns just the job-card fragment. No login required.
        slug_kw = _slugify(keyword)
        slug_loc = _slugify(location)
        if slug_kw:
            segment = f"keywords-{slug_kw}"
            if slug_loc:
                segment += f"-in-{slug_loc}"
            path = f"/{section}/{segment}"
        elif slug_loc:
            path = f"/{section}/{section}-in-{slug_loc}"
        else:
            path = f"/{section}"

        response = self.session.get(f"{INTERNSHALA_BASE}{path}/ajax/")
        response.raise_for_status()
        return self._parse_response(response, job_type=job_type)

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
                portal_metadata=self._metadata_from_json(item),
            ))
        return jobs

    def _parse_html(self, html: str, job_type: str) -> List[Job]:
        soup = BeautifulSoup(html, "html.parser")
        jobs = []

        for card in soup.select(".individual_internship"):
            title_link = card.select_one("a.job-title-href")
            if not title_link:
                continue

            href = title_link.get("href", "")
            apply_link = href if href.startswith("http") else f"{INTERNSHALA_BASE}{href}"
            # Internshala has two ids per listing: the 7-digit `internshipid` and
            # the 10-digit detail-URL id at the end of the href. Only the latter
            # also appears on the "My Applications" page, so we key on it to make
            # applied-status auto-detect (applied.py) able to match.
            detail_ids = re.findall(r"\d{6,}", href)
            job_id = (
                detail_ids[-1] if detail_ids else
                card.get("internshipid") or card.get("data-internship_id") or card.get("data-job_id") or ""
            )

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
                portal_metadata=self._metadata_from_card(card),
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

    @staticmethod
    def _metadata_from_json(item: dict) -> dict:
        logo_url = ""
        for key in (
            "company_logo",
            "company_logo_url",
            "companyLogo",
            "companyLogoUrl",
            "logo",
            "logo_url",
        ):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                logo_url = value.strip()
                break
        return {"company_logo_url": logo_url} if logo_url else {}

    @staticmethod
    def _metadata_from_card(card) -> dict:
        image = card.select_one(".company_logo img, .internship_logo img, img.company-logo, img[src*='company']")
        if not image:
            return {}
        src = image.get("src") or image.get("data-src") or ""
        if not src:
            return {}
        if src.startswith("//"):
            src = f"https:{src}"
        elif src.startswith("/"):
            src = f"{INTERNSHALA_BASE}{src}"
        return {"company_logo_url": src}
