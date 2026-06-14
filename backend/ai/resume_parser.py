import logging
import re
from datetime import date

import pdfplumber
import pypdf

from ai.llm_client import complete_text
from ai.utils import parse_json_response

logger = logging.getLogger(__name__)


def extract_text_from_pdf(pdf_path: str) -> str:
    """Try pdfplumber first, then fall back to pypdf."""
    text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        if text.strip():
            return text
    except Exception as e:
        logger.warning("pdfplumber failed: %s - trying pypdf", e)

    try:
        reader = pypdf.PdfReader(pdf_path)
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n"
    except Exception as e:
        logger.error("pypdf also failed: %s", e)
        raise

    return text


async def parse_resume(pdf_path: str) -> dict:
    raw_text = extract_text_from_pdf(pdf_path)

    if not raw_text.strip():
        raise ValueError("Could not extract any text from the PDF. Is it a scanned/image PDF?")

    try:
        today = date.today().isoformat()
        raw = await complete_text(
            prompt=f"""Extract structured data from this resume.
Today's date is {today}. Use it to compute durations for any role still ongoing.
Return ONLY valid JSON. No explanation, no markdown, no code fences.

Required format:
{{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "current_role": "",
  "total_experience_years": 0,
  "work_periods": [],
  "skills": [],
  "technical_skills": [],
  "soft_skills": [],
  "education": "",
  "education_details": [],
  "summary": "",
  "previous_companies": [],
  "certifications": [],
  "languages": [],
  "linkedin_url": "",
  "github_url": ""
}}

Rules:
- skills: combine technical and soft skills in a flat list
- work_periods: for EACH role under work experience, internships, freelance, or contract
  (NOT education), output an object {{"start": "YYYY-MM", "end": "YYYY-MM"}}. Use "present"
  for the end of any ongoing role ("Present"/"Current"/"Now"/"Till date"). If only a year is
  given, use "YYYY-01". Do NOT include education, projects, or coursework here.
- total_experience_years: estimate total professional experience in years from the
  work_periods above (sum their durations, treating "present" as today). Round to the nearest
  whole number; return at least 1 if any work_period exists, 0 only for a true fresher with no
  work/internship/freelance history.
- education: e.g. "B.Tech Computer Science, VIT University, 2023"
- summary: 2-3 sentence professional summary from the resume; write one if not present
- If a field is missing from the resume, use empty string or empty array

Resume text:
{raw_text[:12000]}""",
            max_tokens=1500,
        )

        parsed = parse_json_response(raw)
        # LLMs are unreliable at date arithmetic, so recompute experience deterministically
        # from the extracted work_periods and take the larger of the two values.
        computed = _years_from_work_periods(parsed.get("work_periods"))
        if computed is not None:
            parsed["total_experience_years"] = max(computed, _safe_int(parsed.get("total_experience_years")))
        return parsed
    except Exception as exc:
        logger.warning("AI resume parsing failed; using local fallback parser: %s", exc)
        return _fallback_parse_resume(raw_text)


def _safe_int(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def _years_from_work_periods(periods) -> int | None:
    """Sum the (merged, non-overlapping) durations of extracted work periods -> whole years."""
    if not isinstance(periods, list) or not periods:
        return None
    today = date.today()
    intervals: list[tuple[date, date]] = []
    for period in periods:
        if not isinstance(period, dict):
            continue
        start = _parse_year_month(period.get("start"))
        end_raw = str(period.get("end") or "").strip().lower()
        end = today if end_raw in {"present", "current", "now", "till date", "ongoing", ""} else _parse_year_month(period.get("end"))
        if start and end and end > start:
            intervals.append((start, end))
    if not intervals:
        return None
    intervals.sort()
    merged = [intervals[0]]
    for start, end in intervals[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    total_months = sum((end.year - start.year) * 12 + (end.month - start.month) for start, end in merged)
    return max(0, round(total_months / 12))


def _parse_year_month(value) -> date | None:
    """Parse 'YYYY-MM' or 'YYYY' (also tolerates 'Mon YYYY') into a date (day=1)."""
    if not value:
        return None
    text = str(value).strip()
    iso = re.match(r"(\d{4})\D+(\d{1,2})", text)
    if iso:
        year, month = int(iso.group(1)), min(12, max(1, int(iso.group(2))))
        return date(year, month, 1)
    named = re.search(r"([A-Za-z]{3,9})\.?\s+(\d{4})", text)
    if named:
        month = _MONTHS.get(named.group(1)[:3].lower())
        if month:
            return date(int(named.group(2)), month, 1)
    year_only = re.search(r"(19|20)\d{2}", text)
    if year_only:
        return date(int(year_only.group(0)), 1, 1)
    return None


_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _fallback_parse_resume(raw_text: str) -> dict:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    text = "\n".join(lines)
    lowered = text.lower()
    email = _first_match(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", text)
    phone = _first_match(r"(?:\+?\d[\d\s().-]{7,}\d)", text)
    skills = _known_skills(lowered)
    name = _guess_name(lines, email)
    location = _first_known(lowered, ["bengaluru", "bangalore", "pune", "mumbai", "hyderabad", "delhi", "noida", "gurugram", "remote"])
    role = _first_known(lowered, ["frontend engineer", "frontend developer", "backend engineer", "backend developer", "full stack developer", "software engineer", "devops engineer"])
    years = _experience_years(lowered)

    return {
        "name": name,
        "email": email,
        "phone": phone,
        "location": location.title() if location else "",
        "current_role": role.title() if role else "",
        "total_experience_years": years,
        "skills": skills,
        "technical_skills": skills,
        "soft_skills": [],
        "education": _education_line(lines),
        "education_details": [],
        "summary": _summary(name, role, years, skills),
        "previous_companies": [],
        "certifications": [],
        "languages": [],
        "linkedin_url": _first_match(r"https?://(?:www\.)?linkedin\.com/[^\s]+", text),
        "github_url": _first_match(r"https?://(?:www\.)?github\.com/[^\s]+", text),
    }


def _first_match(pattern: str, text: str) -> str:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(0).strip() if match else ""


def _known_skills(lowered: str) -> list[str]:
    catalog = [
        "React",
        "TypeScript",
        "JavaScript",
        "Python",
        "FastAPI",
        "Node.js",
        "Express",
        "Django",
        "PostgreSQL",
        "Supabase",
        "AWS",
        "Docker",
        "Kubernetes",
        "CI/CD",
        "Git",
        "REST API",
        "GraphQL",
        "Tailwind CSS",
        "HTML",
        "CSS",
    ]
    normalized = lowered.replace("node js", "node.js").replace("rest apis", "rest api")
    return [skill for skill in catalog if skill.lower() in normalized]


def _guess_name(lines: list[str], email: str) -> str:
    for line in lines[:8]:
        lowered = line.lower()
        if email and email.lower() in lowered:
            continue
        if any(marker in lowered for marker in ("resume", "curriculum", "phone", "email", "linkedin", "github")):
            continue
        if len(line.split()) <= 5 and re.search(r"[A-Za-z]", line):
            return line
    return "Candidate"


def _first_known(lowered: str, values: list[str]) -> str:
    return next((value for value in values if value in lowered), "")


def _experience_years(lowered: str) -> int:
    match = re.search(r"(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)", lowered)
    return int(float(match.group(1))) if match else 0


def _education_line(lines: list[str]) -> str:
    markers = ("b.tech", "bachelor", "master", "m.tech", "b.e.", "bsc", "msc", "university", "college")
    for line in lines:
        if any(marker in line.lower() for marker in markers):
            return line
    return ""


def _summary(name: str, role: str, years: int, skills: list[str]) -> str:
    role_label = role.title() if role else "software professional"
    experience = f"{years}+ years" if years else "hands-on"
    skill_text = ", ".join(skills[:5]) if skills else "modern software delivery"
    return f"{name or 'Candidate'} is a {role_label} with {experience} of experience across {skill_text}."
