from __future__ import annotations

import asyncio
import logging
import secrets
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from playwright.async_api import async_playwright
from playwright.sync_api import sync_playwright

from core.database import NULL_RESULT, get_db
from portals.naukri.auth import BASE_HEADERS, DASHBOARD_URL, NaukriAuthClient

logger = logging.getLogger(__name__)

LOGIN_URL = "https://www.naukri.com/nlogin/login"
HOME_URL = "https://www.naukri.com/mnjuser/homepage"
PROFILE_ROOT = Path(__file__).resolve().parents[2] / "chrome_profiles" / "naukri"
PROFILE_DIR = PROFILE_ROOT
CONNECT_TIMEOUT_SECONDS = 8 * 60
PROFILE_LOCK_TIMEOUT_SECONDS = 30
BROWSER_LAUNCH_TIMEOUT_SECONDS = 45
PROFILE_SETTLE_MS = 3000
STORAGE_TOKEN_SCRIPT = """
() => {
  const candidates = [];
  const stores = [window.localStorage, window.sessionStorage];
  const looksUseful = (key, value) => {
    const text = String(value || "");
    const lowered = String(key || "").toLowerCase();
    return text.length > 20 && (
      lowered.includes("token") ||
      lowered.includes("auth") ||
      lowered.includes("nauk") ||
      text.startsWith("eyJ")
    );
  };
  const scanValue = (key, value) => {
    const text = String(value || "").trim();
    if (looksUseful(key, value) && !text.startsWith("{") && !text.startsWith("[")) {
      candidates.push(String(value));
    }
    try {
      const parsed = JSON.parse(value);
      const stack = [parsed];
      while (stack.length) {
        const item = stack.pop();
        if (!item || typeof item !== "object") continue;
        for (const [nestedKey, nestedValue] of Object.entries(item)) {
          if (typeof nestedValue === "string" && looksUseful(nestedKey, nestedValue)) {
            candidates.push(nestedValue);
          } else if (nestedValue && typeof nestedValue === "object") {
            stack.push(nestedValue);
          }
        }
      }
    } catch {
      // Non-JSON storage values are expected.
    }
  };
  for (const store of stores) {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      scanValue(key, store.getItem(key));
    }
  }
  return candidates[0] || "";
}
"""

_profile_locks: dict[str, threading.Lock] = {}
_profile_locks_guard = threading.Lock()


@dataclass
class NaukriConnectSession:
    connection_id: str
    user_id: str
    state: str
    message: str
    started_at: str
    updated_at: str
    profile_id: str = ""

    def public(self) -> dict[str, str]:
        payload = asdict(self)
        payload.pop("user_id", None)
        return payload


_sessions: dict[str, NaukriConnectSession] = {}
_user_connections: dict[str, str] = {}
_tasks: dict[str, threading.Thread] = {}


def start_naukri_connect(user_id: str) -> dict[str, str]:
    existing_id = _user_connections.get(user_id)
    existing = _sessions.get(existing_id or "")
    if existing and existing.state in {"starting", "waiting_for_login"}:
        thread = _tasks.get(existing.connection_id)
        if thread and not thread.is_alive():
            _update(
                existing.connection_id,
                state="failed",
                message="Naukri connection worker stopped before login completed. Start Connect again.",
            )
        else:
            return existing.public()
    existing = _sessions.get(existing_id or "")
    if existing and existing.state in {"starting", "waiting_for_login"}:
        return existing.public()

    connection_id = secrets.token_urlsafe(12)
    now = _now()
    session = NaukriConnectSession(
        connection_id=connection_id,
        user_id=user_id,
        state="starting",
        message="Opening Naukri login window...",
        started_at=now,
        updated_at=now,
    )
    _sessions[connection_id] = session
    _user_connections[user_id] = connection_id
    thread = threading.Thread(
        target=_run_capture_thread,
        args=(connection_id, user_id),
        name=f"naukri-connect-{connection_id}",
        daemon=True,
    )
    _tasks[connection_id] = thread
    thread.start()
    return session.public()


def get_naukri_connect_status(
    user_id: str,
    connection_id: Optional[str] = None,
) -> dict[str, str]:
    lookup_id = connection_id or _user_connections.get(user_id, "")
    session = _sessions.get(lookup_id)
    if session and session.user_id == user_id:
        return session.public()

    connected = _connected_status_from_db(user_id)
    if connected:
        return connected

    return {
        "connection_id": "",
        "state": "idle",
        "message": "No active Naukri connection attempt.",
        "started_at": "",
        "updated_at": _now(),
        "profile_id": "",
    }


def build_auth_from_browser_profile(
    token_hint: str = "",
    profile_id_hint: str = "",
    profile_path: str = "",
    user_id: str = "",
) -> NaukriAuthClient:
    auth = NaukriAuthClient()
    token = token_hint
    auth.token_refreshed_from_profile = False

    if token:
        auth.bearer_token = token
        auth.session.headers.update({"Authorization": f"Bearer {token}"})

    auth.profile_id = profile_id_hint
    if not auth.profile_id and token:
        auth.profile_id = asyncio.run(_fetch_profile_id_with_token(token))
    return auth


def refresh_naukri_auth(
    user_id: str,
    token_row: dict | None = None,
) -> NaukriAuthClient:
    token_row = token_row or _load_token_row(user_id) or {}
    auth = build_auth_from_browser_profile(
        token_row.get("bearer_token") or "",
        token_row.get("profile_id") or "",
        token_row.get("chrome_profile_path") or "",
        user_id,
    )
    if auth.bearer_token and auth.profile_id and getattr(auth, "token_refreshed_from_profile", False):
        _save_token(
            user_id,
            auth.bearer_token,
            auth.profile_id,
            str(_resolve_profile_dir(token_row.get("chrome_profile_path") or "", user_id)),
        )
    return auth


def _browser_profile_cookies(profile_path: str = "", user_id: str = "") -> list[dict]:
    cookies, _token = _browser_profile_state(_resolve_profile_dir(profile_path, user_id))
    return cookies


def _browser_profile_state(profile_dir: Path) -> tuple[list[dict], str]:
    profile_dir.mkdir(parents=True, exist_ok=True)
    captured_tokens: list[str] = []
    with _profile_lock(profile_dir):
        with sync_playwright() as playwright:
            context = _launch_refresh_context(playwright, profile_dir)
            try:
                page = context.new_page()

                def on_request(request) -> None:
                    token = _extract_bearer(request.headers.get("authorization", ""))
                    if token:
                        captured_tokens.append(token)

                page.on("request", on_request)
                for url in ("https://www.naukri.com/", HOME_URL, "https://www.naukri.com/mnjuser/profile"):
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        page.wait_for_timeout(PROFILE_SETTLE_MS)
                    except Exception:
                        logger.debug("Naukri profile refresh navigation failed for %s", url, exc_info=True)
                cookies = context.cookies()
                token = (
                    _cookie_value(cookies, "nauk_at")
                    or _sync_page_storage_token(page)
                    or (captured_tokens[-1] if captured_tokens else "")
                )
                return cookies, token
            finally:
                context.close()


def _launch_refresh_context(playwright, profile_dir: Path):
    common = {
        "user_data_dir": str(profile_dir),
        "headless": True,
        "viewport": {"width": 1280, "height": 820},
        "user_agent": BASE_HEADERS["User-Agent"],
        "locale": "en-US",
        "timezone_id": "Asia/Kolkata",
        "extra_http_headers": {"Accept-Language": "en-US,en;q=0.9"},
    }
    try:
        return playwright.chromium.launch_persistent_context(**common)
    except Exception:
        logger.debug("Bundled Chromium Naukri refresh failed; falling back to installed Chrome", exc_info=True)
        return playwright.chromium.launch_persistent_context(channel="chrome", **common)


def _cookie_value(cookies: list[dict], name: str) -> str:
    for cookie in cookies:
        if cookie.get("name") == name and cookie.get("value"):
            return str(cookie["value"])
    return ""


def _sync_page_storage_token(page) -> str:
    try:
        token = page.evaluate(STORAGE_TOKEN_SCRIPT)
    except Exception:
        return ""
    return str(token or "")


def _profile_dir_for_user(user_id: str) -> Path:
    safe_id = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in str(user_id).strip())
    return PROFILE_ROOT / (safe_id or "default")


def _resolve_profile_dir(profile_path: str = "", user_id: str = "") -> Path:
    fallback = _profile_dir_for_user(user_id) if user_id else PROFILE_DIR
    if not profile_path:
        return fallback

    try:
        candidate = Path(profile_path)
        if not candidate.is_absolute():
            candidate = (Path.cwd() / candidate).resolve()
        else:
            candidate = candidate.resolve()
        root = PROFILE_ROOT.resolve()
        if candidate == root or root in candidate.parents:
            return candidate
    except Exception:
        logger.debug("Ignoring invalid Naukri profile path %s", profile_path, exc_info=True)
    return fallback


def _profile_lock(profile_dir: Path) -> threading.Lock:
    key = str(profile_dir.resolve())
    with _profile_locks_guard:
        lock = _profile_locks.get(key)
        if not lock:
            lock = threading.Lock()
            _profile_locks[key] = lock
        return lock


def _load_token_row(user_id: str) -> dict | None:
    try:
        db = get_db()
        result = db.table("portal_tokens").select("*").eq(
            "user_id",
            user_id,
        ).eq("portal", "naukri").maybe_single().execute() or NULL_RESULT
    except Exception:
        logger.debug("Could not load Naukri token row for %s", user_id, exc_info=True)
        return None
    return result.data


def _run_capture_thread(connection_id: str, user_id: str) -> None:
    try:
        if hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        asyncio.run(_run_capture(connection_id, user_id))
    except Exception as exc:
        logger.error("Naukri connect worker crashed: %s", exc)
        _update(
            connection_id,
            state="failed",
            message=f"Naukri connection failed: {exc or exc.__class__.__name__}",
        )
        _tasks.pop(connection_id, None)


async def _run_capture(connection_id: str, user_id: str) -> None:
    captured_tokens: list[str] = []
    captured_profile_ids: list[str] = []
    context = None
    profile_dir = _profile_dir_for_user(user_id)
    profile_lock = _profile_lock(profile_dir)
    lock_acquired = False

    try:
        profile_dir.mkdir(parents=True, exist_ok=True)
        _update(
            connection_id,
            state="waiting_for_login",
            message="Log in to Naukri in the opened browser window. Hunter will save the connection automatically.",
        )

        _update(
            connection_id,
            state="starting",
            message="Starting the Naukri browser session...",
        )
        lock_acquired = profile_lock.acquire(timeout=PROFILE_LOCK_TIMEOUT_SECONDS)
        if not lock_acquired:
            _update(
                connection_id,
                state="failed",
                message="Naukri profile is busy. Close any Hunter-opened Naukri browser window and try Connect again.",
            )
            return
        lock_acquired = True
        async with async_playwright() as playwright:
            context = await _launch_login_context(playwright, profile_dir)
            page = await context.new_page()

            async def on_request(request) -> None:
                token = _extract_bearer(request.headers.get("authorization", ""))
                if token:
                    captured_tokens.append(token)

            async def on_response(response) -> None:
                url = response.url.lower()
                if not any(marker in url for marker in ("login", "dashboard", "profiles")):
                    return
                try:
                    data = await response.json()
                except Exception:
                    return

                token = _find_first(data, {"authToken", "token", "bearerToken", "accessToken"})
                profile_id = _find_first(data, {"profileId", "profile_id", "userId"})
                if token:
                    captured_tokens.append(str(token))
                if profile_id:
                    captured_profile_ids.append(str(profile_id))

            page.on("request", on_request)
            page.on("response", on_response)
            _update(
                connection_id,
                state="waiting_for_login",
                message="Naukri browser is open. Complete the login there; Hunter will connect automatically.",
            )
            await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)

            deadline = asyncio.get_running_loop().time() + CONNECT_TIMEOUT_SECONDS
            while asyncio.get_running_loop().time() < deadline:
                token = await _latest_token(context, captured_tokens, page)
                profile_id = captured_profile_ids[-1] if captured_profile_ids else ""

                if token and not profile_id:
                    profile_id = await _fetch_profile_id_with_token(token)
                if token and not profile_id and not page.is_closed():
                    profile_id = await _fetch_profile_id_from_page(page, token)

                if token and profile_id:
                    settled_token = await _settle_logged_in_profile(context, page, captured_tokens)
                    if not settled_token:
                        await asyncio.sleep(2)
                        continue
                    token = settled_token
                    await asyncio.to_thread(_save_token, user_id, token, profile_id, str(profile_dir))
                    _update(
                        connection_id,
                        state="connected",
                        message="Naukri connected. Token is saved and hidden.",
                        profile_id=profile_id,
                    )
                    await context.close()
                    context = None
                    return

                if page.is_closed() and not context.pages:
                    break
                await asyncio.sleep(2)

            _update(
                connection_id,
                state="expired",
                message="Naukri login was not detected before the connection window expired. Start Connect again when you are ready to log in.",
            )
    except Exception as exc:
        logger.error("Naukri connect capture failed: %s", exc)
        _update(
            connection_id,
            state="failed",
            message=f"Naukri connection failed: {exc or exc.__class__.__name__}",
        )
    finally:
        if context:
            try:
                await context.close()
            except Exception:
                logger.debug("Naukri connect browser context was already closed", exc_info=True)
        if lock_acquired:
            profile_lock.release()
        _tasks.pop(connection_id, None)


async def _launch_login_context(playwright, profile_dir: Path):
    common = {
        "user_data_dir": str(profile_dir),
        "headless": False,
        "viewport": {"width": 1280, "height": 820},
        "user_agent": BASE_HEADERS["User-Agent"],
        "locale": "en-US",
        "timezone_id": "Asia/Kolkata",
        "extra_http_headers": {"Accept-Language": "en-US,en;q=0.9"},
    }

    async def launch(**kwargs):
        return await playwright.chromium.launch_persistent_context(
            **common,
            **kwargs,
        )

    try:
        return await asyncio.wait_for(launch(), timeout=BROWSER_LAUNCH_TIMEOUT_SECONDS)
    except Exception as first_exc:
        logger.warning("Bundled Chromium launch failed for Naukri connect: %s", first_exc)
        try:
            return await asyncio.wait_for(launch(channel="chrome"), timeout=BROWSER_LAUNCH_TIMEOUT_SECONDS)
        except Exception as second_exc:
            raise RuntimeError(
                "Could not open the Naukri browser window. Install Playwright Chromium or Google Chrome, then try Connect again."
            ) from second_exc


async def _latest_token(context, captured_tokens: list[str], page=None, start_index: int = 0) -> str:
    try:
        cookies = await context.cookies()
    except Exception:
        cookies = []

    for cookie in cookies:
        if cookie.get("name") == "nauk_at" and cookie.get("value"):
            return str(cookie["value"])
    if page and not page.is_closed():
        token = await _page_storage_token(page)
        if token:
            return token
    fresh_tokens = captured_tokens[start_index:]
    if fresh_tokens:
        return fresh_tokens[-1]
    return ""


async def _page_storage_token(page) -> str:
    try:
        token = await page.evaluate(STORAGE_TOKEN_SCRIPT)
    except Exception:
        return ""
    return str(token or "")


async def _fetch_profile_id_with_token(token: str) -> str:
    headers = BASE_HEADERS.copy()
    headers.update({
        "authorization": f"Bearer {token}",
        "systemid": "Naukri",
    })
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(DASHBOARD_URL, headers=headers)
            if response.status_code >= 400:
                return ""
            data = response.json()
    except Exception:
        return ""
    return str(_find_first(data, {"profileId", "profile_id", "userId"}) or "")


async def _fetch_profile_id_from_page(page, token: str) -> str:
    try:
        data = await page.evaluate(
            """
            async ({ url, token }) => {
              const response = await fetch(url, {
                headers: {
                  accept: "application/json",
                  appid: "105",
                  clientid: "d3skt0p",
                  authorization: `Bearer ${token}`,
                  systemid: "Naukri",
                },
                credentials: "include",
              });
              if (!response.ok) return null;
              return await response.json();
            }
            """,
            {"url": DASHBOARD_URL, "token": token},
        )
    except Exception:
        return ""
    return str(_find_first(data, {"profileId", "profile_id", "userId"}) or "")


async def _settle_logged_in_profile(context, page, captured_tokens: list[str]) -> str:
    start_index = len(captured_tokens)
    for url in (HOME_URL, "https://www.naukri.com/"):
        if page.is_closed():
            break
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(PROFILE_SETTLE_MS)
        except Exception:
            logger.debug("Naukri post-login settle failed for %s", url, exc_info=True)
    return await _latest_token(context, captured_tokens, page, start_index)


def _save_token(user_id: str, token: str, profile_id: str, profile_path: str = "") -> None:
    db = get_db()
    db.table("portal_tokens").upsert({
        "user_id": user_id,
        "portal": "naukri",
        "bearer_token": token,
        "profile_id": profile_id,
        "chrome_profile_path": profile_path or str(_profile_dir_for_user(user_id)),
    }, on_conflict="user_id,portal").execute()


def _connected_status_from_db(user_id: str) -> dict[str, str] | None:
    try:
        db = get_db()
        result = db.table("portal_tokens").select(
            "profile_id, created_at",
        ).eq("user_id", user_id).eq("portal", "naukri").maybe_single().execute() or NULL_RESULT
    except Exception:
        return None

    if not result.data:
        return None

    return {
        "connection_id": "",
        "state": "connected",
        "message": "Naukri is already connected.",
        "started_at": str(result.data.get("created_at") or ""),
        "updated_at": _now(),
        "profile_id": str(result.data.get("profile_id") or ""),
    }


def _extract_bearer(value: str) -> str:
    if not value:
        return ""
    prefix = "bearer "
    lowered = value.lower()
    if lowered.startswith(prefix):
        return value[len(prefix):].strip()
    return ""


def _find_first(value: Any, keys: set[str]) -> Any:
    if isinstance(value, dict):
        for key in keys:
            if value.get(key):
                return value[key]
        for item in value.values():
            found = _find_first(item, keys)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_first(item, keys)
            if found:
                return found
    return None


def _update(
    connection_id: str,
    *,
    state: str,
    message: str,
    profile_id: str = "",
) -> None:
    session = _sessions.get(connection_id)
    if not session:
        return
    session.state = state
    session.message = message
    session.updated_at = _now()
    if profile_id:
        session.profile_id = profile_id


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
