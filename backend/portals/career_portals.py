"""Registry + shared logic for credential-based company career portals.

These are single-employer career sites where the candidate has an account with a
clean email+password login and a readable "My Applications" list — so Hunter can
auto-detect applied status (unlike CAPTCHA/OTP/SSO-gated portals). Two platforms
today, dispatched by portal key:

- **SuccessFactors** (DWR): Wipro, HCLTech — ``portals/successfactors``
- **Infosys** (Keycloak + REST): infosys — ``portals/infosys``

Everything portal-agnostic (credential storage, status, the login dispatcher)
lives here so the routes, reconcile service, and UI stay platform-neutral. Adding
an employer on an existing platform is a config row; a new platform is a new
``login_and_fetch`` branch here.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from core.encryption import decrypt
from portals.infosys.client import login_and_fetch as _infosys_login_and_fetch
from portals.infosys.config import LABEL as INFOSYS_LABEL
from portals.successfactors.client import login_and_fetch as _sf_login_and_fetch
from portals.successfactors.config import SF_TENANTS, is_sf_portal

logger = logging.getLogger(__name__)

# portal_key -> display label
CAREER_LABELS: dict[str, str] = {
    **{key: tenant["label"] for key, tenant in SF_TENANTS.items()},
    "infosys": INFOSYS_LABEL,
}


def is_career_portal(portal_key: str) -> bool:
    return portal_key in CAREER_LABELS


def career_label(portal_key: str) -> str:
    return CAREER_LABELS.get(portal_key, (portal_key or "").title() or "This portal")


def career_portal_home(portal_key: str) -> str:
    """A best-effort careers URL for the portal, used as the link on imported jobs."""
    tenant = SF_TENANTS.get(portal_key)
    if tenant:
        return tenant.get("careers_url", "")
    if portal_key == "infosys":
        return "https://career.infosys.com/joblist"
    return ""


def login_and_fetch(portal_key: str, email: str, password: str, verify_only: bool = False) -> dict:
    """Dispatch to the right platform handler. Returns {ok, applications, error}.

    ``verify_only=True`` confirms the login without reading the applications — used by
    the connect flow so connecting is fast.
    """
    if is_sf_portal(portal_key):
        return _sf_login_and_fetch(portal_key, email, password, verify_only=verify_only)
    if portal_key == "infosys":
        return _infosys_login_and_fetch(email, password, verify_only=verify_only)
    return {"ok": False, "applications": [], "error": "unknown_portal"}


def verify_login(portal_key: str, email: str, password: str) -> dict:
    """Verify a career-portal login works (used by the connect flow). Raises on failure."""
    result = login_and_fetch(portal_key, email, password, verify_only=True)
    if not result.get("ok"):
        raise ValueError(result.get("error") or "login_failed")
    return result


# --- shared credential storage / status (keyed by portal in portal_tokens) ---

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_career_credentials(db, user_id: str, portal_key: str) -> Optional[tuple[str, str]]:
    """Return (username, password) decrypted from storage, or None if not connected."""
    result = db.table("portal_tokens").select("*").eq(
        "user_id", user_id,
    ).eq("portal", portal_key).maybe_single().execute()
    row = (result.data if result else None) or {}
    encrypted = row.get("password_encrypted") or ""
    username = row.get("username") or ""
    if not (encrypted and username):
        return None
    try:
        password = decrypt(encrypted)
    except Exception:
        logger.warning("Could not decrypt stored %s password for user %s", portal_key, user_id)
        set_career_auth_failed(db, user_id, portal_key, True)
        return None
    return username, password


def set_career_auth_failed(db, user_id: str, portal_key: str, failed: bool) -> None:
    """Record whether the last silent re-login failed (best-effort)."""
    try:
        db.table("portal_tokens").update({
            "auth_failed_at": _now_iso() if failed else None,
        }).eq("user_id", user_id).eq("portal", portal_key).execute()
    except Exception:
        logger.debug("Could not update %s auth_failed_at for %s", portal_key, user_id, exc_info=True)


def career_status(row: dict) -> dict:
    """Honest connection status for the Portals UI based on cached state only."""
    has_creds = bool(row.get("password_encrypted") and row.get("username"))
    auth_failed = bool(row.get("auth_failed_at"))
    label = career_label(row.get("portal", ""))

    if has_creds and not auth_failed:
        return _status(
            "connected", False,
            f"{label} login saved. Hunter signs in to auto-detect which jobs you've applied to.",
        )
    if has_creds and auth_failed:
        return _status(
            "expired", True,
            f"{label} sign-in stopped working (password changed or account locked). "
            "Sign in again to reconnect.",
        )
    return _status("expired", True, f"{label} not connected. Sign in to enable applied-status sync.")


def _status(connection_status: str, requires_reconnect: bool, message: str) -> dict:
    return {
        "connection_status": connection_status,
        "requires_reconnect": requires_reconnect,
        "status_message": message,
        "last_checked_at": _now_iso(),
    }
