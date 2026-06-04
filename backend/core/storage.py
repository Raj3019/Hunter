from urllib.parse import unquote, urlparse

from core.config import SUPABASE_URL

RESUME_BUCKET = "resumes"


def create_signed_resume_url(db, storage_path_or_url: str, expires_in: int = 3600) -> str:
    storage_path = resume_storage_path(storage_path_or_url)
    if not storage_path:
        return ""

    result = db.storage.from_(RESUME_BUCKET).create_signed_url(storage_path, expires_in)
    signed_url = (
        result.get("signedURL")
        or result.get("signed_url")
        or result.get("signedUrl")
        or result.get("url")
        or ""
    )
    if signed_url.startswith("/"):
        return f"{SUPABASE_URL.rstrip('/')}{signed_url}"
    return signed_url


def resume_storage_path(storage_path_or_url: str) -> str:
    if not storage_path_or_url:
        return ""

    value = storage_path_or_url.strip()
    if not value.startswith(("http://", "https://")):
        return _strip_bucket_prefix(value)

    parsed = urlparse(value)
    path = unquote(parsed.path)
    marker = f"/storage/v1/object/"
    if marker not in path:
        return ""

    object_path = path.split(marker, 1)[1]
    parts = object_path.split("/", 2)
    if len(parts) < 3:
        return ""

    bucket = parts[1]
    if bucket != RESUME_BUCKET:
        return ""
    return parts[2]


def _strip_bucket_prefix(value: str) -> str:
    clean = value.strip().lstrip("/")
    prefix = f"{RESUME_BUCKET}/"
    return clean[len(prefix):] if clean.startswith(prefix) else clean
