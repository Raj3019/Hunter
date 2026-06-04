from core.storage import resume_storage_path
from services.tailored_resume_service import (
    _storage_path,
    _string_list,
    build_tailored_resume_docx,
    validate_tailored_resume,
)


SAMPLE_RESUME = {
    "name": "Arjun Kumar",
    "email": "arjun@example.com",
    "phone": "9876543210",
    "location": "Bengaluru",
    "current_role": "Frontend Engineer",
    "total_experience_years": 3,
    "skills": ["React", "TypeScript", "FastAPI", "Playwright"],
    "education": "B.Tech Computer Science",
    "education_details": [
        {"year": "2024", "degree": "Bachelor of Computer Applications (BCA)", "institution": "K.P.B Hinduja College of Commerce"},
    ],
    "summary": "Frontend engineer building React applications.",
}

SAMPLE_TAILORED = {
    "tailored_summary": "Frontend Engineer with 3 years experience building React dashboards and API-integrated workflows.",
    "reordered_skills": ["React", "TypeScript", "Kubernetes", "FastAPI"],
    "highlighted_experience": [
        "Built React dashboards with TypeScript and API integrations.",
    ],
    "changes_made": ["Reordered skills toward the frontend role."],
    "warnings": "",
}


def main():
    safe_tailored, validation = validate_tailored_resume(
        original_text="React TypeScript FastAPI Playwright dashboard automation",
        resume_parsed=SAMPLE_RESUME,
        tailored=SAMPLE_TAILORED,
    )
    assert validation["ok"] is True
    assert "Kubernetes" in validation["removed_skills"]
    assert "Kubernetes" not in safe_tailored["reordered_skills"]

    docx_bytes = build_tailored_resume_docx(
        resume_parsed=SAMPLE_RESUME,
        original_text="PROJECTS\nBuilt Neo Hire workflows.\nEXPERIENCE\nIntegrated AI resume analysis.",
        job_data={"title": "Frontend Engineer", "company": "Hunter", "location": "Remote"},
        tailored=safe_tailored,
    )
    assert docx_bytes.startswith(b"PK")
    assert len(docx_bytes) > 1000
    assert _string_list(SAMPLE_RESUME["education_details"]) == [
        "Bachelor of Computer Applications (BCA), K.P.B Hinduja College of Commerce, 2024"
    ]
    assert _storage_path(
        user_id="user-id",
        match_id="match-id",
        version="tailored:2026-06-04T10:30:00Z",
        resume_data={"file_url": "https://example.supabase.co/storage/v1/object/public/resumes/user-id/akshay-resume.pdf"},
    ).endswith("/akshay-resume-tailor.docx")
    assert resume_storage_path(
        "https://example.supabase.co/storage/v1/object/public/resumes/user-id/tailored/match-id/file.docx"
    ) == "user-id/tailored/match-id/file.docx"
    assert resume_storage_path(
        "https://example.supabase.co/storage/v1/object/sign/resumes/user-id/original/resume.pdf?token=abc"
    ) == "user-id/original/resume.pdf"
    print("[PASS] Tailored resume validation and DOCX generation")


if __name__ == "__main__":
    main()
