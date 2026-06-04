import os
import tempfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ai.resume_parser import extract_text_from_pdf, parse_resume
from core.auth import get_current_user_id
from core.database import get_db
from core.storage import create_signed_resume_url

router = APIRouter()
MAX_RESUME_BYTES = 10 * 1024 * 1024


@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content = await file.read()
    if len(content) > MAX_RESUME_BYTES:
        raise HTTPException(status_code=400, detail="File too large - max 10MB")

    db = get_db()
    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        raw_text = extract_text_from_pdf(tmp_path)
        parsed = await parse_resume(tmp_path)

        safe_filename = os.path.basename(file.filename or "resume.pdf")
        storage_path = f"{user_id}/{safe_filename}"
        db.storage.from_("resumes").upload(
            storage_path,
            content,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        file_url = db.storage.from_("resumes").get_public_url(storage_path)

        db.table("resumes").insert({
            "user_id": user_id,
            "file_url": file_url,
            "parsed_data": parsed,
            "raw_text": raw_text[:50000],
        }).execute()

        return {"success": True, "parsed": parsed}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@router.get("/parsed")
async def get_parsed_resume(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    result = db.table("resumes").select(
        "parsed_data, file_url, created_at"
    ).eq("user_id", user_id).order(
        "created_at",
        desc=True,
    ).limit(1).maybe_single().execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="No resume found - please upload first")
    result.data["file_url"] = create_signed_resume_url(db, result.data.get("file_url", ""))
    return result.data
