import logging

from ai.llm_client import complete_text

logger = logging.getLogger(__name__)

COMMON_ANSWERS = {
    "notice period": "Immediately available",
    "current ctc": "",
    "expected ctc": "",
    "are you willing to relocate": "Yes",
    "do you have valid work authorization": "Yes",
    "are you a fresher": "",
}


async def answer_question(question: str, user_profile: dict) -> str:
    """
    Return a short, direct answer to a job application question.
    Uses profile lookups first, then Claude for context-dependent questions.
    """
    q_lower = question.lower().strip()

    if any(k in q_lower for k in ["notice period", "when can you join", "joining"]):
        return user_profile.get("notice_period", "Immediately")
    if any(k in q_lower for k in ["current ctc", "current salary", "current package"]):
        return str(user_profile.get("current_ctc", ""))
    if any(k in q_lower for k in ["expected ctc", "expected salary", "expected package"]):
        return str(user_profile.get("expected_ctc", ""))
    if any(k in q_lower for k in ["phone", "mobile", "contact number"]):
        return user_profile.get("phone", "")
    if any(k in q_lower for k in ["email"]):
        return user_profile.get("email", "")
    if any(k in q_lower for k in ["years of experience", "total experience", "work experience"]):
        return str(user_profile.get("total_experience_years", "0"))
    if any(k in q_lower for k in ["name", "full name", "first name"]):
        return user_profile.get("name", "")
    if any(k in q_lower for k in ["location", "city", "current location"]):
        return user_profile.get("location", "")

    return await complete_text(
        prompt=f"""Answer this job application form question.
Give a SHORT, DIRECT answer only. No explanation. No quotes. Max 2 sentences.
If the question asks for a number, give only the number.
If yes/no, answer Yes or No.

QUESTION: {question}

CANDIDATE PROFILE:
{user_profile}

Answer:""",
        max_tokens=150,
    )
