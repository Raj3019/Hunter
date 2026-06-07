"""
Durable Naukri authentication.

Naukri's ``nauk_at`` bearer token is a JWT that expires ~1 hour after issue, and
Naukri logs a browser session out once that token lapses (purging the long-lived
``nauk_rt`` refresh cookie). Persisting only the 1-hour token therefore makes the
connection die within an hour.

To keep the connection valid until Naukri naturally rejects the account, we store
the user's Naukri credentials encrypted (Fernet/AES-256) and silently re-login to
mint a fresh token whenever the cached one is missing or expired. The plain-text
password is decrypted only at the moment of the login call and deleted right after.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from core.database import get_db
from core.encryption import decrypt
from portals.naukri.auth import NaukriAuthClient

logger = logging.getLogger(__name__)

# Refresh a little before the token actually expires so an in-flight request does
# not race the expiry boundary.
TOKEN_EXPIRY_SKEW_SECONDS = 120


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def decode_jwt_exp(token: str) -> Optional[datetime]:
    """Return the UTC expiry of a JWT access token, or None if undecodable."""
    if not token or token.count(".") < 2:
        return None
    payload_b64 = token.split(".")[1]
    payload_b64 += "=" * (-len(payload_b64) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    except (binascii.Error, ValueError, json.JSONDecodeError):
        return None
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        return None
    return datetime.fromtimestamp(exp, tz=timezone.utc)


def _token_is_live(token: str, expires_at: Optional[str]) -> bool:
    """Whether the cached token is present and not within the expiry skew window."""
    if not token:
        return False
    expiry = decode_jwt_exp(token)
    if expiry is None and expires_at:
        expiry = _parse_iso(expires_at)
    if expiry is None:
        # Unknown expiry: treat as not live so we refresh rather than send a dead token.
        return False
    return expiry.timestamp() - _now().timestamp() > TOKEN_EXPIRY_SKEW_SECONDS


def _parse_iso(value: str) -> Optional[datetime]:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _build_auth_with_token(token: str, profile_id: str) -> NaukriAuthClient:
    auth = NaukriAuthClient()
    auth.bearer_token = token
    auth.profile_id = profile_id or None
    auth.session.headers.update({"Authorization": f"Bearer {token}"})
    return auth


def login_with_credentials(username: str, password: str) -> dict:
    """Log in to Naukri and return a fresh session payload.

    Returns a dict with ``bearer_token``, ``profile_id`` and ``expires_at`` (ISO).
    Raises on failure (invalid credentials, CAPTCHA, network).
    """
    auth = NaukriAuthClient()
    session = auth.login(username, password)
    token = session.bearer_token or ""
    expiry = decode_jwt_exp(token)
    return {
        "bearer_token": token,
        "profile_id": session.profile_id or "",
        "expires_at": expiry.isoformat() if expiry else None,
    }


def _load_token_row(db, user_id: str) -> dict:
    result = db.table("portal_tokens").select("*").eq(
        "user_id", user_id,
    ).eq("portal", "naukri").maybe_single().execute()
    return (result.data if result else None) or {}


def _persist_refreshed_token(db, user_id: str, payload: dict) -> None:
    db.table("portal_tokens").update({
        "bearer_token": payload["bearer_token"],
        "profile_id": payload.get("profile_id") or None,
        "expires_at": payload.get("expires_at"),
    }).eq("user_id", user_id).eq("portal", "naukri").execute()


def set_auth_failed(db, user_id: str, failed: bool) -> None:
    """Record whether the last silent re-login failed.

    Best-effort: tolerant of the ``auth_failed_at`` column not existing yet so a
    deploy before migration 007 still refreshes tokens normally.
    """
    try:
        db.table("portal_tokens").update({
            "auth_failed_at": _now_iso() if failed else None,
        }).eq("user_id", user_id).eq("portal", "naukri").execute()
    except Exception:
        logger.debug("Could not update Naukri auth_failed_at for %s", user_id, exc_info=True)


def get_valid_naukri_auth(
    user_id: str,
    token_row: Optional[dict] = None,
) -> Optional[NaukriAuthClient]:
    """Return an authenticated NaukriAuthClient, refreshing the token if needed.

    Uses the cached bearer token while it is live. When it is expired/missing but
    encrypted credentials are stored, silently re-logs in and persists the fresh
    token. Returns None when there is no usable login (caller should fall back to
    public search).
    """
    db = get_db()
    row = token_row if token_row is not None else _load_token_row(db, user_id)
    if not row:
        return None

    token = row.get("bearer_token") or ""
    if _token_is_live(token, row.get("expires_at")):
        return _build_auth_with_token(token, row.get("profile_id") or "")

    encrypted = row.get("password_encrypted") or ""
    username = row.get("username") or ""
    if not (encrypted and username):
        # Legacy/browser-only connection with a dead token and no stored creds.
        return None

    try:
        password = decrypt(encrypted)
    except Exception:
        logger.warning("Could not decrypt stored Naukri password for user %s", user_id)
        set_auth_failed(db, user_id, True)
        return None

    try:
        payload = login_with_credentials(username, password)
    except Exception as exc:
        logger.warning("Naukri silent re-login failed for user %s: %s", user_id, exc)
        set_auth_failed(db, user_id, True)
        return None
    finally:
        del password

    try:
        _persist_refreshed_token(db, user_id, payload)
    except Exception:
        logger.debug("Could not persist refreshed Naukri token for %s", user_id, exc_info=True)
    set_auth_failed(db, user_id, False)

    return _build_auth_with_token(payload["bearer_token"], payload.get("profile_id") or "")


def naukri_status(row: dict) -> dict:
    """Honest connection status for the Portals UI based on cached state only.

    No network call: relies on the cached token's JWT expiry and whether stored
    credentials can silently refresh it.
    """
    has_creds = bool(row.get("password_encrypted") and row.get("username"))
    token_live = _token_is_live(row.get("bearer_token") or "", row.get("expires_at"))
    auth_failed = bool(row.get("auth_failed_at"))

    if token_live:
        return _status(
            "connected",
            False,
            "Naukri login is active." if not has_creds
            else "Naukri login is active and will refresh automatically.",
        )
    if has_creds and not auth_failed:
        return _status(
            "connected",
            False,
            "Naukri login saved. The session refreshes automatically when needed.",
        )
    if has_creds and auth_failed:
        return _status(
            "expired",
            True,
            "Naukri sign-in stopped working (password changed, account locked, or extra "
            "verification needed). Sign in again to reconnect.",
        )
    return _status(
        "expired",
        True,
        "Naukri session expired. Sign in again to reconnect.",
    )


def _status(connection_status: str, requires_reconnect: bool, message: str) -> dict:
    return {
        "connection_status": connection_status,
        "requires_reconnect": requires_reconnect,
        "status_message": message,
        "last_checked_at": _now_iso(),
    }
