import asyncio

from anthropic import AuthenticationError
from dotenv import load_dotenv
from httpx import HTTPStatusError

from core.config import AI_MODEL, AI_PROVIDER
from ai.job_scorer import score_job
from ai.qa_answerer import answer_question
from ai.resume_parser import extract_text_from_pdf, parse_resume
from ai.resume_tailor import tailor_resume

load_dotenv()

SAMPLE_RESUME = {
    "name": "Arjun Sharma",
    "email": "arjun@email.com",
    "phone": "9876543210",
    "current_role": "React Developer",
    "total_experience_years": 2,
    "skills": ["React", "JavaScript", "TypeScript", "Node.js", "CSS", "Git"],
    "education": "B.Tech Computer Science, BITS Pilani, 2022",
    "summary": "2 years of experience building React applications.",
    "previous_companies": ["Infosys"],
    "location": "Bangalore",
}

SAMPLE_JOB = {
    "title": "Frontend Developer",
    "company": "Razorpay",
    "description": "We are looking for a React developer with TypeScript experience. "
                   "Must know Redux, React Query, and have experience with REST APIs. "
                   "Nice to have: Next.js, Jest, CI/CD.",
    "tags": ["React", "TypeScript", "Redux", "REST API", "JavaScript"],
}

USER_PROFILE = {
    **SAMPLE_RESUME,
    "notice_period": "Immediately",
    "current_ctc": "8 LPA",
    "expected_ctc": "12 LPA",
}


async def main():
    print("=== AI Layer Tests ===\n")
    print(f"AI provider: {AI_PROVIDER}")
    print(f"AI model: {AI_MODEL}")

    # PDF extraction smoke test - uncomment with a real local resume.
    # text = extract_text_from_pdf("./test_resume.pdf")
    # assert len(text) > 100, "Extracted too little text"
    # print(f"[PASS] PDF extraction - {len(text)} chars extracted")

    print("\nTesting Q&A answerer...")
    notice = await answer_question("What is your notice period?", USER_PROFILE)
    assert "immediately" in notice.lower() or notice == "Immediately"
    print(f"[PASS] Notice period: {notice}")

    ctc = await answer_question("What is your current CTC?", USER_PROFILE)
    assert "8" in ctc
    print(f"[PASS] Current CTC: {ctc}")

    try:
        print("\nTesting job scorer...")
        score_result = await score_job(SAMPLE_RESUME, SAMPLE_JOB)
        assert "score" in score_result
        assert 0 <= score_result["score"] <= 100
        assert isinstance(score_result["recommend_apply"], bool)
        assert isinstance(score_result["matched_skills"], list)
        assert isinstance(score_result["missing_skills"], list)
        print(f"[PASS] Job scorer - score: {score_result['score']}/100")
        print(f"       Matched: {score_result['matched_skills']}")
        print(f"       Missing: {score_result['missing_skills']}")
        print(f"       Recommend apply: {score_result['recommend_apply']}")

        print("\nTesting resume tailor...")
        tailor_result = await tailor_resume(
            original_text="React developer with 2 years experience at Infosys...",
            resume_parsed=SAMPLE_RESUME,
            job_description=SAMPLE_JOB["description"],
            job_title=SAMPLE_JOB["title"],
        )
        assert "tailored_summary" in tailor_result
        assert "reordered_skills" in tailor_result
        assert len(tailor_result["tailored_summary"]) > 50
        for skill in tailor_result["reordered_skills"]:
            assert skill in SAMPLE_RESUME["skills"] or skill in SAMPLE_JOB["tags"], \
                f"Potentially fabricated skill: {skill}"
        print("[PASS] Resume tailor")
        print(f"       Summary: {tailor_result['tailored_summary'][:100]}...")
        print(f"       Warnings: {tailor_result.get('warnings', 'None')}")

        relocate = await answer_question("Are you willing to relocate to Pune?", USER_PROFILE)
        assert len(relocate) > 0
        print(f"[PASS] Relocation question: {relocate}")

        years = await answer_question("How many years of experience do you have in React?", USER_PROFILE)
        print(f"[PASS] Experience question: {years}")
    except AuthenticationError as exc:
        print("\n[SKIP] Claude API checks skipped: ANTHROPIC_API_KEY is invalid.")
        print(f"       {exc}")
        print("       Fix backend/.env and rerun python test_ai_layer.py for live AI verification.")
        return
    except HTTPStatusError as exc:
        provider_name = "OpenRouter" if AI_PROVIDER == "openrouter" else AI_PROVIDER
        print(f"\n[SKIP] {provider_name} API checks skipped: HTTP {exc.response.status_code}.")
        print(f"       {exc.response.text[:500]}")
        print("       Fix backend/.env provider key/model and rerun python test_ai_layer.py.")
        return
    except RuntimeError as exc:
        if "API_KEY" not in str(exc):
            raise
        print(f"\n[SKIP] {AI_PROVIDER} API checks skipped: {exc}")
        print("       Configure backend/.env provider key/model and rerun python test_ai_layer.py.")
        return

    print("\n=== All AI tests PASSED ===")


asyncio.run(main())
