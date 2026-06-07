# Production Readiness — Deferred Items

Status: **NOT deploying yet.** Running locally (server on the owner's own machine, effectively single user). Everything below is safe to defer until an actual server deployment for multiple users. Captured 2026-06-06 so it is not lost.

The durable Naukri credential login itself IS production-compatible (browserless API login, per-user `portal_tokens` rows, DB-backed, survives restarts) and will behave identically on a server. The items below are the surrounding things that must be handled **before deploying for real users**.

## Must-do before production

1. **Gate the browser-login / guided "Connect" flow to dev only.**
   - `backend/portals/naukri/connect.py` launches Playwright with `headless=False` — a visible browser window on the server. On a headless server it can't run, and even if it did, it opens on the server, not the remote user's machine.
   - In production the email+password credential form (`POST /api/portals/naukri/credentials`) must be the only Naukri connect path. Hide/disable the "Advanced: browser login" option in prod (env flag).
   - Same applies to LinkedIn/Workday/Taleo/Internshala browser automation — not usable for remote users. Only the assist-only "open the portal URL in the user's own browser" flow is server-safe.

2. **Run APScheduler in exactly one process.**
   - `backend/main.py` starts the scheduler on FastAPI startup. With multiple uvicorn/gunicorn workers or instances, each runs the 8am `daily_job_fetch` → duplicate fetches. Use a dedicated worker, a leader-election/DB lock, or run the scheduler as a separate single process.

3. **Plan for Naukri's single-IP anti-bot limit (biggest scaling risk).**
   - All users' Naukri logins, token refreshes (~1/hour each), and searches go out from the server's one IP. Many users → likely CAPTCHA/IP block (`CLAUDE.md`: session bound to the Elastic IP, no proxy rotation).
   - Mitigations to consider: minimize logins (cache tokens, lazy refresh — already lazy), stagger/rate-limit, monitor for CAPTCHAs, or revisit the no-proxy rule. Fine for a handful of users; risky at dozens+.

4. **Secrets & data protection.**
   - `ENCRYPTION_KEY` must be stable and secret in prod (e.g., AWS Secrets Manager). If it changes, every stored password becomes undecryptable and all users must reconnect.
   - The app stores third-party (Naukri / company portal) passwords for many users — real security + privacy/legal weight. Lock down the key, DB access, and backups.
   - Confirm Supabase **RLS is actually enabled** in prod (schema defines policies — verify they are on). Set production `FRONTEND_ORIGINS`/CORS and serve over HTTPS.

## Naukri reliability hardening (deferred — from the NopeRi reference)

These two improve Naukri reliability under real-world / multi-user conditions but aren't needed while local single-user. Do them when prepping for production or when symptoms appear.

5. **TLS-fingerprint HTTP session for Naukri.** Naukri fingerprints TLS; plain `requests` is easier to flag → more CAPTCHAs / MFA / degraded headless pages (observed repeatedly in dev). Switch the Naukri session to a client that impersonates Chrome's TLS (`curl_cffi` — already listed as a fallback in `CLAUDE.md`; NopeRi uses an equivalent). Swap the session factory used by `portals/naukri/auth.py` / job client. Most valuable at scale / on server IPs.

6. **OTP/MFA login support.** When Naukri challenges a login with MFA (common on flagged/cloud IPs or new devices), the credential re-login currently fails silently → "session expired". NopeRi handles it via `send_otp` / `verify_otp` (`central-login-services/v1/otp` + `v0/otp-login`). Add those calls plus a small "enter OTP" UI step in the connect/reconnect flow so MFA doesn't break the durable login.

## Good-to-know (not blockers)
- In-memory state isn't shared across workers: the auth TTL cache (`core/auth.py`), `_manual_search_locks` (`api/routes/jobs.py`), and browser-connect sessions (`connect.py`) are per-process. Harmless beyond slightly weaker dedupe/cache; another reason the browser-connect path is dev-only.
- `core/auth.py` still calls Supabase `get_user` on a cache miss (30s TTL cache added). Fine; optional future improvement is local JWT verification with the Supabase JWT secret.
