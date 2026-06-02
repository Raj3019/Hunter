import logging

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
- total_experience_years: calculate from work history dates; 0 if fresher
- education: e.g. "B.Tech Computer Science, VIT University, 2023"
- summary: 2-3 sentence professional summary from the resume; write one if not present
- If a field is missing from the resume, use empty string or empty array

Resume text:
{raw_text[:6000]}""",
        max_tokens=1500,
    )

    return parse_json_response(raw)
