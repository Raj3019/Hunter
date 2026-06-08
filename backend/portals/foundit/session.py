"""
Durable Foundit authentication.

Foundit issues a bearer token (``MSSOAT``/authToken) on login that lapses after a
while, and the public search endpoint needs no login at all. The *applied-status*
sync, however, reads the authenticated "My Applies" history, so it needs a session
that stays valid unattended.

Mirroring the Naukri approach: we store the user's Foundit credentials encrypted
(Fernet/AES-256) and silently re-login to mint a fresh token whenever the cached
one is missing or rejected. The plain-text password is decrypted only at the
moment of the login call and deleted right after.

Foundit's token format is opaque (not a decodable JWT like Naukri's), so instead
of decoding an expiry we cheaply probe the profile endpoint (``is_token_valid``)
and re-login on rejection.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from core.database import get_db
from core.encryption import decrypt
from portals.foundit.auth import BASE_HEADERS, FounditAuthClient

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def login_with_foundit_credentials(email: str, password: str) -> dict:
    """Log in to Foundit and return a fresh session payload.

    Returns a dict with ``bearer_token`` and ``profile_id``. Raises on failure
    (invalid credentials, CAPTCHA, network).
    """
    auth = FounditAuthClient()
    session = auth.login(email, password)
    return {
        "bearer_token": session.bearer_token or "",
        "profile_id": session.user_id or "",
    }


def _build_auth_with_token(token: str, profile_id: str) -> FounditAuthClient:
    auth = FounditAuthClient()
    auth.bearer_token = token
    auth.user_id = profile_id or None
    auth.session.headers.update(BASE_HEADERS)
    auth.session.headers.update({"Authorization": f"Bearer {token}"})
    return auth


def _load_token_row(db, user_id: str) -> dict:
    result = db.table("portal_tokens").select("*").eq(
        "user_id", user_id,
    ).eq("portal", "foundit").maybe_single().execute()
    return (result.data if result else None) or {}


def _persist_refreshed_token(db, user_id: str, payload: dict) -> None:
    db.table("portal_tokens").update({
        "bearer_token": payload["bearer_token"],
        "profile_id": payload.get("profile_id") or None,
    }).eq("user_id", user_id).eq("portal", "foundit").execute()


def set_auth_failed(db, user_id: str, failed: bool) -> None:
    """Record whether the last silent re-login failed (best-effort)."""
    try:
        db.table("portal_tokens").update({
            "auth_failed_at": _now_iso() if failed else None,
        }).eq("user_id", user_id).eq("portal", "foundit").execute()
    except Exception:
        logger.debug("Could not update Foundit auth_failed_at for %s", user_id, exc_info=True)


def get_valid_foundit_auth(
    user_id: str,
    token_row: Optional[dict] = None,
) -> Optional[FounditAuthClient]:
    """Return an authenticated FounditAuthClient, refreshing the token if needed.

    Uses the cached bearer token while Foundit still accepts it. When it is
    missing/rejected but encrypted credentials are stored, silently re-logs in and
    persists the fresh token. Returns None when there is no usable login.
    """
    db = get_db()
    row = token_row if token_row is not None else _load_token_row(db, user_id)
    if not row:
        return None

    token = row.get("bearer_token") or ""
    if token:
        auth = _build_auth_with_token(token, row.get("profile_id") or "")
        if auth.is_token_valid():
            return auth

    encrypted = row.get("password_encrypted") or ""
    username = row.get("username") or ""
    if not (encrypted and username):
        # Legacy token-only connection with a dead token and no stored creds.
        return None

    try:
        password = decrypt(encrypted)
    except Exception:
        logger.warning("Could not decrypt stored Foundit password for user %s", user_id)
        set_auth_failed(db, user_id, True)
        return None

    try:
        payload = login_with_foundit_credentials(username, password)
    except Exception as exc:
        logger.warning("Foundit silent re-login failed for user %s: %s", user_id, exc)
        set_auth_failed(db, user_id, True)
        return None
    finally:
        del password

    try:
        _persist_refreshed_token(db, user_id, payload)
    except Exception:
        logger.debug("Could not persist refreshed Foundit token for %s", user_id, exc_info=True)
    set_auth_failed(db, user_id, False)

    return _build_auth_with_token(payload["bearer_token"], payload.get("profile_id") or "")


def foundit_status(row: dict) -> dict:
    """Honest connection status for the Portals UI based on cached state only.

    No network call: relies on whether a token and/or stored credentials exist.
    """
    has_creds = bool(row.get("password_encrypted") and row.get("username"))
    has_token = bool(row.get("bearer_token"))
    auth_failed = bool(row.get("auth_failed_at"))

    if has_creds and not auth_failed:
        return _status(
            "connected",
            False,
            "Foundit login saved. The session refreshes automatically when needed.",
        )
    if has_creds and auth_failed:
        return _status(
            "expired",
            True,
            "Foundit sign-in stopped working (password changed, account locked, or extra "
            "verification needed). Sign in again to reconnect.",
        )
    if has_token:
        return _status(
            "connected",
            False,
            "Foundit connected. Add your login to keep applied-status sync running automatically.",
        )
    return _status(
        "expired",
        True,
        "Foundit session expired. Sign in again to reconnect.",
    )


def _status(connection_status: str, requires_reconnect: bool, message: str) -> dict:
    return {
        "connection_status": connection_status,
        "requires_reconnect": requires_reconnect,
        "status_message": message,
        "last_checked_at": _now_iso(),
    }
