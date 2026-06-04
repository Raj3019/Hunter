# Code Standards

## General

- Fix root causes, do not layer workarounds — if a portal returns 403, debug the header/token, do not add a silent retry loop
- Keep portal modules self-contained — do not mix Naukri logic into a Foundit file
- One responsibility per module: auth, search, and apply are always separate files within a portal
- Do not combine unrelated concerns in a single commit or PR (e.g. UI changes and scheduler changes)

## Python

- Python 3.11. Use `dataclasses` for structured data (e.g. `Job`, `NaukriSession`). Use Pydantic models only at the API boundary.
- All FastAPI route handlers and portal methods that do I/O must be `async`. Use `httpx.AsyncClient` inside async handlers — never `requests` (it blocks the event loop).
- Use `requests` only in local test scripts and one-off debugging — never inside the FastAPI app.
- Type-annotate all function signatures. Use `Optional[str]` not bare `str | None` for compatibility.
- Validate and parse all external input (portal API responses, user-uploaded JSON, request bodies) before using it. Never trust keys from external JSON without `.get()` with a default.
- Destructure portal API responses defensively: `data.get("jobDetails") or data.get("jobs") or []`

## FastAPI

- Route handlers do one thing: validate input → call a service/portal method → persist result → return response. No business logic inline.
- Always enforce auth and ownership check before any DB mutation.
- Return consistent response shapes. On success: `{"success": True, ...payload}`. On error: use FastAPI `HTTPException` with a clear detail string.
- Never return a password, `password_encrypted`, or Bearer token in any response after initial save.

## Playwright

- Always use `launch_persistent_context` with a per-portal `user_data_dir` path — never `launch()` — so sessions persist between runs.
- Default `headless=False` for login flows and apply flows so unexpected popups are visible.
- Always `await browser.close()` before returning from any function, including error paths.
- Delete decrypted passwords from memory immediately after `page.fill()`:
  ```python
  await page.fill(selector, password)
  del password
  ```
- Use `try/except` around `page.click()` calls with timeouts — portal UI changes break selectors. Log the failure and return `{"success": False, "reason": "..."}` rather than raising.
- Add `await asyncio.sleep(random.uniform(min, max))` after every apply action — never apply without a delay.

## AI (Claude API)

- All Claude calls use model `claude-sonnet-4-20250514`.
- All prompts must instruct the model to return **only valid JSON** with no surrounding text. Always `json.loads(msg.content[0].text.strip())` the response.
- Resume tailor rule: **never invent skills or experience not in the original resume**. This must appear verbatim in the prompt.
- Validate resume tailoring output before generating or approving an artifact. If a skill, employer, date, title, certification, or claim is not grounded in the uploaded resume, block it or surface it as a warning.
- Tailored resume drafts are per-job artifacts. Never overwrite the base uploaded resume, and never let Apply now use a draft until the user approves it.
- Keep AI module functions pure: they receive plain dicts/strings and return plain dicts/strings. No DB calls, no Playwright, no portal logic inside `backend/ai/`.

## Security (non-negotiable)

- Encrypt passwords with `core/encryption.py` (Fernet AES-256) immediately when received from the frontend — before any DB write.
- `ENCRYPTION_KEY` only in `.env`. Never hardcode, never commit.
- Never log a decrypted password — not even at DEBUG level.
- Never return a password field in any API response.
- All production traffic over HTTPS only.

## File Organization

- `backend/portals/<portal>/` — auth, jobs, apply (one file each per portal)
- `backend/portals/custom/registry.py` — single source of truth for all company portal selectors; add new companies here only
- `backend/ai/` — Claude API calls only; no portal or DB logic
- `backend/core/` — config, database client, encryption utility; no business logic
- `backend/api/routes/` — FastAPI routers; thin handlers only
- `backend/api/models/` — Pydantic models for request/response validation
- `frontend/src/api/client.js` — all API calls go through this single axios instance with the JWT interceptor
- `chrome_profiles/` — gitignored; never commit browser session data

## HTTP Client Selection

| Situation | Use |
|---|---|
| Inside FastAPI async handler | `httpx.AsyncClient` |
| Local test script | `requests` |
| Site blocks httpx (TLS fingerprint) | `curl_cffi` with `impersonate="chrome120"` |
| Site blocks all HTTP clients | Playwright network interception |

## Tool Selection (Browser)

| Situation | Use |
|---|---|
| Standard portal forms | Playwright |
| Site detects standard Playwright | Nodriver |
| Nodriver also fails | Camoufox (last resort) |
| Legacy reference repos use Selenium | Rewrite their logic in Playwright |
