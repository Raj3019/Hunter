"""Headless Keycloak login to Infosys careers + read the candidate's applications.

Login is plain email+password (Keycloak OIDC, no OTP/reCAPTCHA — verified live).
The applied list is the JSON `candidateApplicationsList` returned by the authed
`getCandidateApplications` REST call that fires on the "My Applications" page.

Sync Playwright on purpose: callers run it via ``asyncio.to_thread`` (mirrors the
SuccessFactors client) which also avoids Windows asyncio/Playwright issues.
"""

from __future__ import annotations

import json
import logging
import re

from playwright.sync_api import sync_playwright

from portals.infosys.config import APPLICATIONS_API_MARKER, APPLICATIONS_URL, LOGIN_URL

logger = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
NAV_TIMEOUT = 60_000


def _status_from_item(item: dict) -> str:
    """Best-effort current status for an application item.

    The item carries an ``appStatusFlow`` (a status timeline); we read a label
    off its latest entry, falling back to a flat status field, then "Applied".
    """
    flow = item.get("appStatusFlow")
    if isinstance(flow, list) and flow:
        latest = flow[-1] if isinstance(flow[-1], dict) else (flow[0] if isinstance(flow[0], dict) else None)
        if isinstance(latest, dict):
            for key, value in latest.items():
                if isinstance(value, str) and value and any(
                        s in key.lower() for s in ("status", "stage", "name", "label", "desc")):
                    return value
    for key in ("applicationStatus", "status", "jobsStatus"):
        value = item.get(key)
        if isinstance(value, str) and value:
            return value
    return "Applied"


def parse_applications(payload_text: str) -> list[dict]:
    """Parse a getCandidateApplications JSON payload into normalized applications."""
    if not payload_text:
        return []
    try:
        data = json.loads(payload_text)
    except Exception:
        return []
    items = data.get("candidateApplicationsList") or []
    apps: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        # a withdrawn/revoked application shouldn't count as applied
        if str(item.get("revokeStatus") or "").upper() == "Y":
            continue
        app_id = item.get("applicationId")
        apps.append({
            "application_id": str(app_id or ""),
            "job_title": item.get("jobTitle") or "",
            "status": _status_from_item(item),
            "job_req_id": str(item.get("jobApplyId") or item.get("jobapplyid")
                              or item.get("applicationformid") or ""),
            "location": item.get("jobLocation") or "",
        })
    return apps


def login_and_fetch(email: str, password: str, verify_only: bool = False) -> dict:
    """Log in to Infosys careers and return submitted applications.

    Returns ``{"ok": bool, "applications": [...], "error": str|None}``. ``ok`` is
    False on missing form or invalid credentials. ``verify_only=True`` confirms the
    login without reading the applications (fast path for the connect flow).
    """
    captured = {"apps": None}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_context(user_agent=UA).new_page()

            def on_resp(resp):
                if APPLICATIONS_API_MARKER in resp.url and captured["apps"] is None:
                    try:
                        captured["apps"] = resp.text()
                    except Exception:
                        pass
            page.on("response", on_resp)

            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            # career.infosys.com redirects to the Keycloak form; wait for it to settle
            try:
                page.wait_for_selector("input[type='password']", timeout=25_000)
            except Exception:
                return {"ok": False, "applications": [], "error": "login_form_not_found"}

            page.fill("#username, input[name='username'], input[type='email']", email)
            page.fill("#password, input[name='password'], input[type='password']", password)
            submit = (page.query_selector("#kc-login") or page.query_selector("input[type='submit']")
                      or page.query_selector("button[type='submit']")
                      or page.query_selector("button:has-text('Sign In')")
                      or page.query_selector("button:has-text('Login')"))
            if submit is None:
                return {"ok": False, "applications": [], "error": "submit_not_found"}
            submit.click()
            try:
                page.wait_for_load_state("domcontentloaded", timeout=40_000)
            except Exception:
                pass
            page.wait_for_timeout(3_500)

            # invalid credentials keep us on the Keycloak host with the password field
            host_match = re.match(r"https?://([^/]+)", page.url)
            host = host_match.group(1) if host_match else ""
            if "infosysapps.com" in host and page.query_selector("input[type='password']") is not None:
                return {"ok": False, "applications": [], "error": "invalid_credentials"}

            logged_in = "career.infosys.com" in page.url and page.query_selector("input[type='password']") is None

            if verify_only:
                return {"ok": bool(logged_in), "applications": [],
                        "error": None if logged_in else "login_failed"}

            # trigger the applications API if it hasn't fired yet
            if captured["apps"] is None:
                try:
                    page.goto(APPLICATIONS_URL, wait_until="domcontentloaded", timeout=25_000)
                    page.wait_for_timeout(4_000)
                except Exception:
                    pass

            if not logged_in and captured["apps"] is None:
                return {"ok": False, "applications": [], "error": "login_failed"}

            return {"ok": True, "applications": parse_applications(captured["apps"] or ""), "error": None}
        finally:
            try:
                browser.close()
            except Exception:
                pass
