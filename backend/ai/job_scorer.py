import logging

from ai.llm_client import complete_text
from ai.utils import parse_json_response

logger = logging.getLogger(__name__)


async def score_job(resume: dict, job: dict) -> dict:
    """
    Return a score dict with score, matched skills, missing skills, reasons,
    and recommend_apply.
    """
    raw = await complete_text(
        prompt=f"""Score this candidate for this job. Return ONLY valid JSON.

Scoring rules:
- 80-100: Strong match - most required skills present, relevant experience
- 60-79: Good match - some skills missing but strong overall fit
- 40-59: Partial match - key gaps but transferable skills
- 0-39: Poor match - significant gaps
- recommend_apply: true if score >= 60

Required JSON format:
{{
  "score": 0,
  "matched_skills": [],
  "missing_skills": [],
  "reasons": [],
  "recommend_apply": false
}}

CANDIDATE PROFILE:
Name: {resume.get("name")}
Current role: {resume.get("current_role")}
Experience: {resume.get("total_experience_years")} years
Skills: {", ".join(resume.get("skills", [])[:30])}
Education: {resume.get("education")}
Summary: {resume.get("summary", "")[:300]}

JOB TITLE: {job.get("title")}
COMPANY: {job.get("company")}
REQUIRED SKILLS/TAGS: {", ".join(job.get("tags", []))}
JOB DESCRIPTION (excerpt):
{str(job.get("description", ""))[:1000]}""",
        max_tokens=600,
    )

    result = parse_json_response(raw)
    result["score"] = max(0, min(100, int(result.get("score", 0))))
    result["recommend_apply"] = result["score"] >= 60
    result.setdefault("matched_skills", [])
    result.setdefault("missing_skills", [])
    result.setdefault("reasons", [])
    return result
