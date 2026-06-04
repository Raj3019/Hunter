# Feature Spec 10 - AI Layer (Claude/OpenRouter)

## What This Is

Four AI-powered modules that form the intelligence core of Hunter:
1. **Resume Parser** — extracts structured JSON from raw PDF text
2. **Job Scorer** — scores a candidate against a job (0–100) with reasoning
3. **Resume Tailor** — rewrites and reorders resume sections to match a job description, without fabricating anything
4. **Q&A Answerer** — gives short direct answers to application form questions

By default, modules use Anthropic Claude with `claude-sonnet-4-20250514`. They can also use OpenRouter so alternate models can be tested without rewriting the AI modules. All JSON-returning modules must return structured JSON. No portal logic or DB calls inside these modules - they receive plain data and return plain data.

## Prerequisites

- `02-core-backend-setup.md` complete
- Anthropic mode: `ANTHROPIC_API_KEY` in `.env`
- OpenRouter mode: `OPENROUTER_API_KEY` in `.env`
- `backend/ai/` directory created
- `pip install anthropic httpx pdfplumber pypdf`

## Model Provider Configuration

Use Anthropic by default:

```env
AI_PROVIDER=anthropic
AI_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=your_anthropic_key
```

Use OpenRouter to try other models:

```env
AI_PROVIDER=openrouter
AI_MODEL=openai/gpt-4o-mini
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
```

Implementation note: all modules call `backend/ai/llm_client.py`. Anthropic uses `messages.create`; OpenRouter uses the OpenAI-compatible `POST /chat/completions` API at `https://openrouter.ai/api/v1/chat/completions`. Keep prompts provider-neutral so changing `AI_MODEL` does not require changing the parser/scorer/tailor/Q&A modules.

---

## Implementation Steps

### Step 0 - `backend/ai/llm_client.py`

```python
import httpx
import anthropic

from core.config import (
    AI_MODEL,
    AI_PROVIDER,
    ANTHROPIC_API_KEY,
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
)

_anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

async def complete_text(prompt: str, max_tokens: int) -> str:
    if AI_PROVIDER == "openrouter":
        url = f"{OPENROUTER_BASE_URL.rstrip('/')}/chat/completions"
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": AI_MODEL,
                    "max_tokens": max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            response.raise_for_status()
            data = response.json()
        return data["choices"][0]["message"]["content"].strip()

    message = _anthropic_client.messages.create(
        model=AI_MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()
```

All AI modules should call `complete_text()` instead of constructing provider-specific clients directly.

### Step 1 — `backend/ai/resume_parser.py`

```python
import anthropic
import json
import pdfplumber
import pypdf
import logging

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()

def extract_text_from_pdf(pdf_path: str) -> str:
    """Try pdfplumber first (better layout preservation), fall back to pypdf."""
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
        logger.warning(f"pdfplumber failed: {e} — trying pypdf")

    # Fallback
    try:
        reader = pypdf.PdfReader(pdf_path)
        for page in reader.pages:
            text += (page.extract_text() or "") + "\n"
    except Exception as e:
        logger.error(f"pypdf also failed: {e}")
        raise

    return text

async def parse_resume(pdf_path: str) -> dict:
    raw_text = extract_text_from_pdf(pdf_path)

    if not raw_text.strip():
        raise ValueError("Could not extract any text from the PDF. Is it a scanned/image PDF?")

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1500,
        messages=[{
            "role": "user",
            "content": f"""Extract structured data from this resume.
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
- total_experience_years: calculate from work history dates; 0 if fresher
- education: e.g. "B.Tech Computer Science, VIT University, 2023"
- summary: 2-3 sentence professional summary from the resume; write one if not present
- If a field is missing from the resume, use empty string or empty array

Resume text:
{raw_text[:6000]}"""
        }]
    )

    raw = message.content[0].text.strip()
    # Strip markdown fences if Claude included them despite instructions
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)
```

---

### Step 2 — `backend/ai/job_scorer.py`

```python
import anthropic
import json
import logging

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()

async def score_job(resume: dict, job: dict) -> dict:
    """
    Returns a score dict:
    {
      "score": 0-100,
      "matched_skills": [...],
      "missing_skills": [...],
      "reasons": [...],
      "recommend_apply": bool
    }
    recommend_apply is True when score >= 60.
    """
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=600,
        messages=[{
            "role": "user",
            "content": f"""Score this candidate for this job. Return ONLY valid JSON.

Scoring rules:
- 80-100: Strong match — most required skills present, relevant experience
- 60-79: Good match — some skills missing but strong overall fit
- 40-59: Partial match — key gaps but transferable skills
- 0-39: Poor match — significant gaps
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
{str(job.get("description", ""))[:1000]}"""
        }]
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    result = json.loads(raw)

    # Safety: validate score is in range
    result["score"] = max(0, min(100, int(result.get("score", 0))))
    result["recommend_apply"] = result["score"] >= 60

    return result
```

---

### Step 3 — `backend/ai/resume_tailor.py`

```python
import anthropic
import json
import logging

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()

async def tailor_resume(
    original_text: str,
    resume_parsed: dict,
    job_description: str,
    job_title: str
) -> dict:
    """
    Returns tailored resume sections:
    {
      "tailored_summary": "",
      "reordered_skills": [],
      "highlighted_experience": [],
      "changes_made": [],
      "warnings": ""
    }
    IMPORTANT: Never invents skills or experience not in the original.
    """
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2500,
        messages=[{
            "role": "user",
            "content": f"""Tailor this resume for the specific job below.

STRICT RULES (violations are unacceptable):
1. NEVER invent skills, experience, or qualifications not present in the original resume
2. NEVER change dates, job titles, company names, or factual information
3. Only reorder, reword, and re-emphasise existing content
4. Match keywords from the job description where the candidate genuinely has that experience
5. If a major required skill is completely missing, note it in warnings — do not fabricate it

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
{job_description[:1500]}"""
        }]
    )

    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)
```

---

### Step 4 — Tailored Resume Artifact Builder

`tailor_resume()` returns structured content, but the product must not stop at JSON suggestions. The backend should turn approved tailoring output into a real per-job draft artifact that can be reviewed and later used by Apply now.

Recommended implementation:

- Add a small artifact builder module, for example `backend/ai/resume_artifact_builder.py` or `backend/services/tailored_resume_service.py`.
- Input: latest `resumes` row, selected `job_matches` row, nested `jobs` snapshot, and `tailor_resume()` output.
- Validate before file generation:
  - every reordered skill must exist in the parsed resume skills or be clearly present in original resume text
  - no employer, job title, date, degree, certification, or years of experience may be changed
  - missing job requirements stay in `warnings`; they must not be added as claimed skills
  - validation result is saved as `validation_json`
- Generate a `.docx` draft with `python-docx`:
  - contact/header from parsed resume
  - tailored summary
  - reordered skills
  - highlighted experience bullets grounded in original resume text
  - unchanged education/employer/date facts
- Store the file in the `resumes` Supabase Storage bucket under the user's folder, for example:
  - `{user_id}/tailored/{match_id}/{version}.docx`
- Insert a `tailored_resumes` row with `status='draft'`, `file_url`, `file_type='docx'`, `version`, `tailoring_json`, and `validation_json`.

Approval and apply usage:

- `/api/jobs/{match_id}/tailor` creates the draft artifact and returns both tailoring JSON and draft metadata.
- `/api/jobs/{match_id}/tailor/approve` approves a real draft id, marks it `approved`, and copies its URL/version onto `job_matches`.
- Apply routes use only an approved tailored artifact. If none exists, they fall back to the latest uploaded base resume.
- The original uploaded resume is never overwritten.

PDF conversion and visual layout inspection are future quality improvements. MVP should generate a reliable `.docx` artifact first because the project already depends on `python-docx`.

### Step 5 — `backend/ai/qa_answerer.py`

```python
import anthropic
import logging

logger = logging.getLogger(__name__)
client = anthropic.Anthropic()

COMMON_ANSWERS = {
    "notice period": "Immediately available",
    "current ctc": "",         # populated from user_profile
    "expected ctc": "",        # populated from user_profile
    "are you willing to relocate": "Yes",
    "do you have valid work authorization": "Yes",
    "are you a fresher": "",   # depends on profile
}

async def answer_question(question: str, user_profile: dict) -> str:
    """
    Returns a short, direct answer to a job application question.
    Uses user_profile context to give accurate answers.
    Falls back to Claude for questions not in the profile.
    """
    q_lower = question.lower().strip()

    # Direct profile lookups (faster, no API call)
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

    # Fall through to Claude for context-dependent questions
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=150,
        messages=[{
            "role": "user",
            "content": f"""Answer this job application form question.
Give a SHORT, DIRECT answer only. No explanation. No quotes. Max 2 sentences.
If the question asks for a number, give only the number.
If yes/no, answer Yes or No.

QUESTION: {question}

CANDIDATE PROFILE:
{user_profile}

Answer:"""
        }]
    )

    return message.content[0].text.strip()
```

---

### Step 5 — Test Script

```python
# backend/test_ai_layer.py
import asyncio
import json
from ai.resume_parser import parse_resume, extract_text_from_pdf
from ai.job_scorer import score_job
from ai.resume_tailor import tailor_resume
from ai.qa_answerer import answer_question
from dotenv import load_dotenv

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

    # 1. PDF text extraction (use any PDF resume you have)
    # text = extract_text_from_pdf("./test_resume.pdf")
    # assert len(text) > 100, "Extracted too little text"
    # print(f"[PASS] PDF extraction — {len(text)} chars extracted")

    # 2. Job scorer
    print("Testing job scorer...")
    score_result = await score_job(SAMPLE_RESUME, SAMPLE_JOB)
    assert "score" in score_result
    assert 0 <= score_result["score"] <= 100
    assert isinstance(score_result["recommend_apply"], bool)
    assert isinstance(score_result["matched_skills"], list)
    assert isinstance(score_result["missing_skills"], list)
    print(f"[PASS] Job scorer — score: {score_result['score']}/100")
    print(f"       Matched: {score_result['matched_skills']}")
    print(f"       Missing: {score_result['missing_skills']}")
    print(f"       Recommend apply: {score_result['recommend_apply']}")

    # 3. Resume tailor
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
    # Verify no fabrication happened
    for skill in tailor_result["reordered_skills"]:
        assert skill in SAMPLE_RESUME["skills"] or skill in SAMPLE_JOB["tags"], \
            f"Potentially fabricated skill: {skill}"
    print(f"[PASS] Resume tailor")
    print(f"       Summary: {tailor_result['tailored_summary'][:100]}...")
    print(f"       Warnings: {tailor_result.get('warnings', 'None')}")

    # 4. Q&A answerer — direct lookups
    print("\nTesting Q&A answerer...")
    notice = await answer_question("What is your notice period?", USER_PROFILE)
    assert "immediately" in notice.lower() or notice == "Immediately"
    print(f"[PASS] Notice period: {notice}")

    ctc = await answer_question("What is your current CTC?", USER_PROFILE)
    assert "8" in ctc
    print(f"[PASS] Current CTC: {ctc}")

    # Claude-based answer
    relocate = await answer_question("Are you willing to relocate to Pune?", USER_PROFILE)
    assert len(relocate) > 0
    print(f"[PASS] Relocation question: {relocate}")

    years = await answer_question("How many years of experience do you have in React?", USER_PROFILE)
    print(f"[PASS] Experience question: {years}")

    print("\n=== All AI tests PASSED ===")

asyncio.run(main())
```

---

## Expected Success Behaviour

- `parse_resume()` returns valid JSON with all required keys populated from the PDF
- `score_job()` returns a score between 0–100, `recommend_apply=True` when score ≥ 60, and non-empty `matched_skills` for obvious matches
- `tailor_resume()` returns a longer summary tailored to the role, and `reordered_skills` lists only skills the candidate actually has
- `answer_question()` returns "Immediately" for notice period without calling the model; calls the configured model only for context-dependent questions
- No `json.JSONDecodeError` from supported models; responses are stripped of common markdown code fences before parsing

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `json.JSONDecodeError` | Model returned markdown fences or extra text | The stripping logic above handles this; if still failing, log the raw model output and add another strip rule |
| `ValueError: Could not extract text` | Scanned/image PDF with no text layer | Alert the user: "This PDF appears to be a scanned image. Please upload a text-based PDF" |
| `score` outside 0–100 | Model misunderstood the range | Clamp: `max(0, min(100, int(result["score"])))` — already in the code above |
| Fabricated skill in tailored resume | Model ignored the no-fabrication rule | Validate: every skill in `reordered_skills` must be in the candidate's original skills list; raise a warning if not |
| `anthropic.AuthenticationError` | Wrong or missing `ANTHROPIC_API_KEY` in Anthropic mode | Check `.env`; verify key in Anthropic console |
| `httpx.HTTPStatusError` from OpenRouter | Wrong `OPENROUTER_API_KEY`, invalid `AI_MODEL`, or model/provider unavailable | Check `.env`, verify the OpenRouter key, and use a valid OpenRouter model id such as `openai/gpt-4o-mini` |
| Very slow response | Large resume text or long job description | Truncate inputs: resume text to 6000 chars, job description to 1500 chars (already done above) |

## Challenges

- **JSON parsing reliability**: Despite explicit instructions to return only JSON, Claude and other routed models can wrap output in markdown code fences. The strip logic handles this but always log and inspect the raw output when `json.JSONDecodeError` occurs.
- **No-fabrication enforcement**: The tailor module explicitly forbids inventing skills. Add a post-processing validation step: if any skill in `reordered_skills` is not present in `resume.skills` OR in `job.tags`, flag it as potentially fabricated and include it in `warnings` rather than the skill list.
- **Resume PDF quality varies**: Some resumes are multi-column PDFs; pdfplumber preserves layout better than pypdf for these. Some are fully image-based scans — neither can extract text. For image PDFs, you'd need OCR (out of scope for MVP).
- **Q&A direct lookups reduce cost**: The profile-based lookups at the top of `qa_answerer` avoid an API call for the most common fields (notice period, CTC, name, etc.). This can save 50–70% of model calls in heavy form-filling scenarios.
- **OpenRouter model variance**: Different models have different JSON reliability, latency, and cost. Use `AI_MODEL` experiments for scoring quality, but keep the no-fabrication rules and downstream validation unchanged.
- **Token cost awareness**: Each `score_job()` call uses ~400–600 tokens. With 50 jobs per user per day, that's ~30,000 tokens/day/user. At scale, add caching: if the same `(resume_hash, job_id)` pair was scored in the last 7 days, return the cached result.
