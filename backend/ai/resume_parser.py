import logging
import re

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
        raw = await complete_text(
            prompt=f"""Extract structured data from this resume.
Return ONLY valid JSON. No explanation, no markdown, no code fences.

Required format:
{{
  "name": "",
  "email": "",
  "phone": "",
  "location": "",
  "current_role": "",
  "total_experience_years": 0,
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
- total_experience_years: estimate total professional experience in years. Add up the
  durations of EVERY dated entry under work experience, internships, freelance, and
  contract roles (treat "Present"/"Current"/"Now" as today's date). Count internships and
  freelance/contract work. If an explicit phrase like "X+ years of experience" appears, use
  the larger of that and your computed sum. Round to the nearest whole number, but return at
  least 1 whenever there is any dated professional/internship entry. Return 0 ONLY for a true
  fresher whose resume has no dated work/internship/freelance history at all (projects and
  coursework alone do not count as experience).
- education: e.g. "B.Tech Computer Science, VIT University, 2023"
- summary: 2-3 sentence professional summary from the resume; write one if not present
- If a field is missing from the resume, use empty string or empty array

Resume text:
{raw_text[:12000]}""",
            max_tokens=1500,
        )

        return parse_json_response(raw)
    except Exception as exc:
        logger.warning("AI resume parsing failed; using local fallback parser: %s", exc)
        return _fallback_parse_resume(raw_text)


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
