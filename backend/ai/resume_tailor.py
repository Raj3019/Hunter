import logging

from ai.llm_client import complete_text
from ai.utils import parse_json_response

logger = logging.getLogger(__name__)


async def tailor_resume(
    original_text: str,
    resume_parsed: dict,
    job_description: str,
    job_title: str,
) -> dict:
    """
    Return tailored resume sections without inventing skills or experience.
    """
    raw = await complete_text(
        prompt=f"""Tailor this resume for the specific job below.

STRICT RULES (violations are unacceptable):
1. NEVER invent skills, experience, or qualifications not present in the original resume
2. NEVER change dates, job titles, company names, or factual information
3. Only reorder, reword, and re-emphasise existing content
4. Match keywords from the job description where the candidate genuinely has that experience
5. If a major required skill is completely missing, note it in warnings - do not fabricate it

Return ONLY valid JSON in this format:
{{
  "tailored_summary": "2-3 sentence summary emphasising relevant experience for this specific role",
  "reordered_skills": ["most relevant skill first", "..."],
  "highlighted_experience": ["bullet point emphasising relevant achievement from work history", "..."],
  "changes_made": ["brief note on each change made"],
  "warnings": "Skills from JD that candidate genuinely lacks; empty string if none"
}}

ORIGINAL RESUME TEXT:
{original_text[:4000]}

CANDIDATE CURRENT SKILLS: {", ".join(resume_parsed.get("skills", []))}
CANDIDATE EXPERIENCE: {resume_parsed.get("total_experience_years")} years

TARGET JOB TITLE: {job_title}
JOB DESCRIPTION:
{job_description[:1500]}""",
        max_tokens=2500,
    )

    result = parse_json_response(raw)
    result.setdefault("tailored_summary", "")
    result.setdefault("reordered_skills", [])
    result.setdefault("highlighted_experience", [])
    result.setdefault("changes_made", [])
    result.setdefault("warnings", "")
    return result
