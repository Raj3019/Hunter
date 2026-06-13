"""Headless login to a SuccessFactors career site + read the candidate's applications.

The login is a plain email+password form POST (no CAPTCHA/OTP — verified live on
Wipro's tenant). After login the candidate portal fires the DWR call
``rcmV12CandidateProfileControllerProxy.getCandidateProfileVO.dwr`` whose response
embeds each submitted application (applicationId, jobTitle, jobStatus, ...). We
capture and parse that — no apply, no writes, read-only.

This is a *sync* Playwright function on purpose: callers run it via
``asyncio.to_thread`` (the same way Foundit's sync client is used), which also
sidesteps Windows asyncio/Playwright event-loop issues.
"""

from __future__ import annotations

import logging
import re

from playwright.sync_api import sync_playwright

from portals.successfactors.config import get_tenant

logger = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
NAV_TIMEOUT = 60_000
PROFILE_VO_MARKER = "getCandidateProfileVO"


def _unescape(value: str) -> str:
    """Decode the lightweight escaping DWR uses inside string literals."""
    value = value.replace("\\/", "/")
    value = re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), value)
    return value.replace('\\"', '"').replace("\\\\", "\\")


def _coerce(raw: str | None):
    """Turn a DWR right-hand-side token into a Python scalar (or None)."""
    if raw is None:
        return None
    raw = raw.strip()
    if raw in ("", "null"):
        return None
    if raw.startswith('"') and raw.endswith('"'):
        return _unescape(raw[1:-1])
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    if raw in ("true", "false"):
        return raw == "true"
    return None  # reference to another var (sNN) — not a scalar we need


# sNN.field=value;  (skips array assignments like s7[0]=s8;)
_ASSIGN_RE = re.compile(r'(s\d+)\.([A-Za-z0-9_]+)=((?:"(?:[^"\\]|\\.)*")|[^;]*);')


def parse_dwr_applications(dwr_text: str) -> list[dict]:
    """Extract submitted applications from a getCandidateProfileVO DWR response.

    Each application object carries an ``applicationId`` plus jobTitle / jobStatus
    / appStatusCode, so we group assignments by their var and keep those.
    """
    if not dwr_text:
        return []
    objs: dict[str, dict] = {}
    for var, field, raw in _ASSIGN_RE.findall(dwr_text):
        objs.setdefault(var, {})[field] = raw

    apps: list[dict] = []
    for fields in objs.values():
        if "applicationId" not in fields:
            continue
        app_id = _coerce(fields.get("applicationId"))
        if not app_id:
            continue
        apps.append({
            "application_id": str(app_id),
            "job_title": _coerce(fields.get("jobTitle")) or "",
            "status": _coerce(fields.get("jobStatus")) or "",
            "status_code": _coerce(fields.get("appStatusCode")),
            "job_req_id": str(_coerce(fields.get("applicantProfileJobReqId"))
                              or _coerce(fields.get("jobReqId")) or ""),
        })
    return apps


def login_and_fetch(portal_key: str, email: str, password: str, verify_only: bool = False) -> dict:
    """Log in to the tenant's SF career site and return any submitted applications.

    Returns ``{"ok": bool, "applications": [...], "error": str|None}``. ``ok`` is
    False on unknown tenant, missing login form, or invalid credentials. Never
    raises for an expected auth failure; raises only on unexpected Playwright
    errors so callers can log them.

    ``verify_only=True`` returns as soon as the login is confirmed (used by the
    connect flow) — it skips reading the applications, so connecting is fast.
    """
    tenant = get_tenant(portal_key)
    if not tenant:
        return {"ok": False, "applications": [], "error": "unknown_tenant"}

    captured = {"vo": ""}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_context(user_agent=UA).new_page()

            def on_resp(resp):
                if PROFILE_VO_MARKER in resp.url and resp.request.method == "POST" and not captured["vo"]:
                    try:
                        captured["vo"] = resp.text()
                    except Exception:
                        pass
            page.on("response", on_resp)

            # domcontentloaded, NOT networkidle — SF's SPA fires hundreds of requests, so
            # waiting for network-idle dragged the connect out to tens of seconds.
            page.goto(tenant["careers_url"], wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            # dismiss cookie banner if present (it can overlay the form)
            for sel in ["#onetrust-accept-btn-handler", "button:has-text('Accept')",
                        "button:has-text('I Accept')"]:
                el = page.query_selector(sel)
                if el:
                    try:
                        el.click()
                        page.wait_for_timeout(300)
                    except Exception:
                        pass
                    break
            # reach the sign-in form (the careers landing needs a "Sign In" click)
            if page.query_selector("input[type='password']") is None:
                try:
                    page.wait_for_selector("text=Sign In", timeout=15_000).click()
                except Exception:
                    pass
            try:
                page.wait_for_selector("input[type='password']", state="visible", timeout=30_000)
            except Exception:
                return {"ok": False, "applications": [], "error": "login_form_not_found"}

            page.fill("input[type='text'], input[type='email']", email)
            page.fill("input[type='password']", password)
            submit = page.query_selector(
                "button:has-text('Sign In'), input[type='submit'], a:has-text('Sign In')")
            if submit is None:
                return {"ok": False, "applications": [], "error": "submit_not_found"}
            submit.click()

            # Login succeeds the moment the post-submit navigation lands and the password
            # field is gone — far faster than waiting for network-idle. Bad credentials
            # keep the password field on screen.
            try:
                page.wait_for_load_state("domcontentloaded", timeout=30_000)
            except Exception:
                pass
            page.wait_for_timeout(1_500)
            if page.query_selector("input[type='password']") is not None:
                return {"ok": False, "applications": [], "error": "invalid_credentials"}

            if verify_only:
                return {"ok": True, "applications": [], "error": None}

            # fetch path: the profile VO fires during the post-login load; give it a beat,
            # else reload the candidate home to trigger it.
            if not captured["vo"]:
                page.wait_for_timeout(2_000)
            if not captured["vo"]:
                try:
                    page.goto(f"https://{tenant['host']}/portalcareer",
                              wait_until="domcontentloaded", timeout=30_000)
                    page.wait_for_timeout(2_500)
                except Exception:
                    pass

            return {"ok": True, "applications": parse_dwr_applications(captured["vo"]),
                    "error": None}
        finally:
            try:
                browser.close()
            except Exception:
                pass
