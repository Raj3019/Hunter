import logging
import re
from typing import Any

from ai.llm_client import complete_text
from ai.utils import parse_json_response

logger = logging.getLogger(__name__)

_AI_SCORING_FALLBACK_REASON: str | None = None

_KNOWN_TECH_SKILLS = (
    "React",
    "Redux",
    "Next.js",
    "Angular",
    "Vue",
    "JavaScript",
    "TypeScript",
    "HTML",
    "CSS",
    "Tailwind",
    "Node.js",
    "Express",
    "Python",
    "FastAPI",
    "Django",
    "Flask",
    "Java",
    "Spring",
    "C#",
    ".NET",
    "PHP",
    "Laravel",
    "SQL",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "AWS",
    "Azure",
    "GCP",
    "Docker",
    "Kubernetes",
    "DevOps",
    "CI/CD",
    "Jenkins",
    "Git",
    "Linux",
    "Terraform",
    "Ansible",
    "Selenium",
    "Playwright",
    "REST",
    "GraphQL",
)

_ROLE_WORDS = {
    "frontend",
    "front end",
    "backend",
    "back end",
    "full stack",
    "devops",
    "developer",
    "engineer",
    "software",
    "web",
    "react",
    "python",
    "java",
    "qa",
    "automation",
}


async def score_job(resume: dict, job: dict) -> dict:
    """
    Return a resume-based score dict with score, matched skills, missing skills, reasons,
    and recommend_apply.
    """
    global _AI_SCORING_FALLBACK_REASON

    if resume.get("_scoring_mode") == "manual_search":
        return _keyword_score_job(resume, job, "Interactive search uses fast local resume/profile scoring")

    if resume.get("_scoring_mode") == "search":
        return _keyword_score_job(resume, job, "Resume scoring is not available for this search")

    if _AI_SCORING_FALLBACK_REASON:
        return _keyword_score_job(resume, job, _AI_SCORING_FALLBACK_REASON)

    try:
        raw = await complete_text(
            prompt=f"""Score this candidate for this job. Return ONLY valid JSON.

Scoring rules:
- Score only from the resume/candidate evidence below. Do not infer skills that are not present.
- 80-100: Strong match - most required skills present, relevant experience
- 60-79: Good match - some skills missing but strong overall fit
- 40-59: Partial match - key gaps but transferable skills
- 0-39: Poor match - significant gaps
- recommend_apply: true if score >= 60

- merits: 2-4 short phrases (max 8 words each) on what makes this candidate a strong fit, grounded ONLY in the resume evidence.
- demerits: 2-4 short phrases (max 8 words each) on the real gaps or risks for this role.

Required JSON format:
{{
  "score": 0,
  "matched_skills": [],
  "missing_skills": [],
  "reasons": [],
  "merits": [],
  "demerits": [],
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
    except Exception as exc:
        _AI_SCORING_FALLBACK_REASON = _fallback_reason(exc)
        logger.warning("AI job scoring unavailable; using local scoring fallback: %s", exc)
        return _keyword_score_job(resume, job, _AI_SCORING_FALLBACK_REASON)

    result["score"] = max(0, min(100, int(result.get("score", 0))))
    result["recommend_apply"] = result["score"] >= 60
    result.setdefault("matched_skills", [])
    result.setdefault("missing_skills", [])
    result.setdefault("reasons", [])
    result.setdefault("merits", [])
    result.setdefault("demerits", [])
    # If the model omitted merits/gaps, derive sensible ones from its own output.
    if not result["merits"] or not result["demerits"]:
        derived = _derive_breakdown(
            result["matched_skills"],
            result["missing_skills"],
            result["score"],
            role_overlap=_role_match_ratio(resume, job) > 0,
        )
        if not result["merits"]:
            result["merits"] = derived["merits"]
        if not result["demerits"]:
            result["demerits"] = derived["demerits"]
    return result


def _derive_breakdown(matched: list, missing: list, score: int, role_overlap: bool) -> dict:
    """Build honest merits/gaps from matched/missing skills + score (no fabrication)."""
    merits: list[str] = []
    if matched:
        merits.append(f"Has {', '.join(str(s) for s in matched[:3])}")
    if role_overlap:
        merits.append("Title and profile align with this role")
    if score >= 60:
        merits.append("Above your recommend threshold (≥60%)")
    if not merits:
        merits.append("Some transferable experience")

    demerits: list[str] = []
    if missing:
        demerits.append(f"Missing {', '.join(str(s) for s in missing[:3])}")
    if not matched:
        demerits.append("Few directly matching skills found")
    if score < 60:
        demerits.append("Below your recommend threshold")
    if not demerits:
        demerits.append("No major gaps detected")
    return {"merits": merits, "demerits": demerits}


def _keyword_score_job(resume: dict, job: dict, fallback_reason: str) -> dict:
    resume_skills = _resume_skills(resume)
    resume_text = _normalized_text(
        [
            resume.get("current_role"),
            resume.get("summary"),
            resume.get("skills"),
            resume.get("technical_skills"),
            resume.get("soft_skills"),
        ]
    )
    job_text = _normalized_text(
        [
            job.get("title"),
            job.get("company"),
            job.get("location"),
            job.get("description"),
            job.get("tags"),
            job.get("portal_metadata"),
        ]
    )
    required_skills = _job_required_skills(job, job_text)

    matched_resume_skills = [
        skill for skill in resume_skills
        if _contains_skill(job_text, skill)
    ]
    matched_required_skills = [
        skill for skill in required_skills
        if _contains_skill(resume_text, skill)
    ]
    matched = _dedupe_display([*matched_required_skills, *matched_resume_skills])[:12]
    missing = [
        skill for skill in required_skills
        if skill not in matched_required_skills and not _contains_skill(resume_text, skill)
    ][:10]

    if required_skills:
        skill_ratio = len(matched_required_skills) / max(1, len(required_skills))
    else:
        skill_ratio = min(len(matched_resume_skills), 8) / max(4, min(len(resume_skills), 8) or 4)

    role_ratio = _role_match_ratio(resume, job)
    evidence_bonus = min(len(matched), 8) / 8
    score = round(20 + (55 * skill_ratio) + (15 * role_ratio) + (10 * evidence_bonus))
    if not matched:
        score = min(score, 35)
    elif role_ratio > 0 and score < 55:
        score = 55

    score = max(0, min(95, int(score)))
    reasons = [
        f"{fallback_reason}; used local resume/job skill matching.",
        f"Matched {len(matched)} resume skills against the job snapshot.",
    ]
    if missing:
        reasons.append(f"Potential gaps: {', '.join(missing[:5])}.")
    if role_ratio > 0:
        reasons.append("Job title or description overlaps with the candidate role/profile.")

    breakdown = _derive_breakdown(matched, missing, score, role_overlap=role_ratio > 0)
    return {
        "score": score,
        "matched_skills": matched,
        "missing_skills": missing,
        "reasons": reasons,
        "merits": breakdown["merits"],
        "demerits": breakdown["demerits"],
        "recommend_apply": score >= 60,
    }


def _resume_skills(resume: dict) -> list[str]:
    values: list[str] = []
    for key in ("skills", "technical_skills", "soft_skills"):
        value = resume.get(key)
        if isinstance(value, list):
            values.extend(str(item).strip() for item in value if str(item).strip())
        elif isinstance(value, str):
            values.extend(item.strip() for item in value.split(",") if item.strip())
    return _dedupe_display(values)


def _job_required_skills(job: dict, job_text: str) -> list[str]:
    skills: list[str] = []
    tags = job.get("tags") or []
    if isinstance(tags, list):
        skills.extend(str(item).strip() for item in tags if str(item).strip())
    elif isinstance(tags, str):
        skills.extend(item.strip() for item in tags.split(",") if item.strip())

    for skill in _KNOWN_TECH_SKILLS:
        if _contains_skill(job_text, skill):
            skills.append(skill)
    return _dedupe_display(skills)


def _role_match_ratio(resume: dict, job: dict) -> float:
    profile_text = _normalized_text([resume.get("current_role"), resume.get("summary"), resume.get("skills")])
    job_title_text = _normalized_text([job.get("title"), job.get("description")])
    if not profile_text or not job_title_text:
        return 0.0

    matched = [
        role for role in _ROLE_WORDS
        if _contains_skill(profile_text, role) and _contains_skill(job_title_text, role)
    ]
    return min(1.0, len(matched) / 3)


def _contains_skill(text: str, skill: str) -> bool:
    if not text or not skill:
        return False
    variants = _skill_variants(skill)
    for variant in variants:
        if not variant:
            continue
        if " " in variant:
            if variant in text:
                return True
            continue
        if re.search(rf"(?<![a-z0-9+#]){re.escape(variant)}(?![a-z0-9+#])", text):
            return True
    return False


def _skill_variants(skill: str) -> list[str]:
    normalized = _normalize_phrase(skill)
    compact = normalized.replace(" ", "")
    variants = [normalized, compact]
    aliases = {
        "javascript": ["js", "java script"],
        "typescript": ["ts", "type script"],
        "react": ["reactjs", "react js", "react.js"],
        "next js": ["nextjs", "next.js"],
        "node js": ["nodejs", "node.js"],
        "ci cd": ["cicd", "ci/cd"],
        "devops": ["dev ops"],
        "frontend": ["front end", "front-end"],
        "backend": ["back end", "back-end"],
        "postgresql": ["postgres"],
        "kubernetes": ["k8s"],
    }
    variants.extend(aliases.get(normalized, []))
    return list(dict.fromkeys(_normalize_phrase(item) for item in variants if item))


def _normalized_text(values: Any) -> str:
    parts = list(_flatten(values))
    return _normalize_phrase(" ".join(str(item) for item in parts if item))


def _normalize_phrase(value: Any) -> str:
    text = str(value or "").lower()
    text = text.replace("&", " and ")
    text = re.sub(r"(?<=\w)[./-](?=\w)", " ", text)
    text = re.sub(r"[^a-z0-9+#]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _flatten(value: Any):
    if isinstance(value, dict):
        for item in value.values():
            yield from _flatten(item)
    elif isinstance(value, (list, tuple, set)):
        for item in value:
            yield from _flatten(item)
    elif value is not None:
        yield value


def _dedupe_display(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        label = str(value).strip()
        key = _normalize_phrase(label)
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(label)
    return result


def _fallback_reason(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    if "missing" in message.lower() or "api_key" in message.lower() or "model" in message.lower():
        return "AI scorer is not fully configured"
    if "timed out" in message.lower():
        return "AI scorer timed out"
    return "AI scorer was unavailable"
