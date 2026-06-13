# Production Readiness — Deferred Items

Status: **NOT deploying yet.** Running locally (server on the owner's own machine, effectively single user). Everything below is safe to defer until an actual server deployment for multiple users. Captured 2026-06-06 so it is not lost.

The durable Naukri credential login itself IS production-compatible (browserless API login, per-user `portal_tokens` rows, DB-backed, survives restarts) and will behave identically on a server. The items below are the surrounding things that must be handled **before deploying for real users**.

## Must-do before production

1. **Browser-login / guided "Connect" flows — REMOVED (done).**
   - The Naukri guided browser-login (`portals/naukri/connect.py`, `headless=False`, routes `/naukri/connect/*`, the "Advanced browser login" UI) and the Internshala browser-connect machinery (`browser_connect.py`/`browser_session.py`) have been **deleted**. They launched a visible browser on the server, which can't run hosted. The email+password **credential form** (`POST /api/portals/naukri/credentials`) is now the only Naukri connect path, and Internshala uses the manual login link. So there is no local-only connect path left to gate.
   - Still server-incompatible if ever wired into a live flow: the **dormant** Playwright apply handlers (`portals/{workday,taleo,internshala,custom}/apply.py`). They're kept as future "verified auto-submit" roadmap and are never called by the assist-only MVP — leave them dormant (or gate behind a dev flag) until that roadmap is built.
   - **⚠️ KNOWN FOOTGUN (deliberately kept for now, June 2026):** `backend/test_naukri.py` step 4 performs a **live auto-apply** — when `TEST_USER_ID` is set (it currently is, in the root `.env`), it calls `run_safe_apply_for_user → jc.apply_job(target)` against a real Naukri listing with no confirmation. This contradicts the assist-only invariant ("MVP never submits unattended"). It only attempts one apply and, in the last run, the target had a mandatory questionnaire so Naukri returned `dataCommitted:False` (nothing submitted) — but a questionnaire-free target *would* file a real application silently. Owner chose to keep it as-is for now. **Before sharing the repo / running the Naukri test casually, comment out that apply block (like `test_foundit.py`/`test_internshala.py` already do) or unset `TEST_USER_ID`.**

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

## Applied-status auto-detect in production (Internshala deferred → manual)

Updated 2026-06-10. **LinkedIn was removed from the product entirely** (no search, no
login, no auto-detect): its login is Cloudflare + CAPTCHA + checkpoint-gated, its
authenticated pages are bot-shielded, and scraping it violates LinkedIn's ToS with real
account-ban risk. It is not feasible by any approach we'd ship, so the portal, its routes,
and the dormant `backend/portals/linkedin/` package were deleted.

**Internshala stays in the product but its applied-status auto-detect is manual.**
Search (unauthenticated) and Open-portal/apply (manual login in the user's own browser)
already work in production untouched. The only piece that does NOT work on a hosted server
is auto-flipping `external_pending → applied`:

- The old detector scraped a **server-side persistent Chrome profile** via Playwright. That
  can't run hosted — the browser would open on the server (not the user's screen), the headless
  `requests` login is reCAPTCHA-gated (`"Captcha error"`), and one profile dir can't serve many
  users. **It has now been removed** (the local-browser scraper + `sync-internshala` route +
  `syncInternshala` client call were deleted in the production-only cleanup, along with the dead
  `browser_connect.py`/`browser_session.py` connect machinery) so the codebase carries no
  local-only path.
- The **one-tap "I applied" / "Could not apply" confirm in Tracker** is the production behavior
  for Internshala applied-status. Re-enabling auto-detect means picking one of the options below.

### Why the user's own logged-in browser can't be read by the web app
The user logs into Internshala in their **own** browser via the manual login link. That session
(cookies) is scoped to `internshala.com`; the browser's **same-origin policy** forbids Hunter's
frontend (different origin) from reading those cookies/DOM or calling Internshala on the user's
behalf. So a plain web app structurally cannot piggyback on "the user is already logged in."

### Possible solutions and their drawbacks (when we revisit)
| Approach | How it works | Drawback |
|---|---|---|
| **Gmail email-parsing (recommended)** | Gmail OAuth (`gmail.readonly`); parse "you applied to X" confirmation emails; reuse the `reconcile_*_applications` matching. | Needs Google CASA security review before public launch; depends on the email arriving; detection only (no search/login). **Upside: one integration covers ALL portals at once** — Internshala, Naukri, Foundit, and the manual-confirm ones (Workday/TCS/etc.). |
| **Browser extension** | Content script runs in the user's already-logged-in Internshala tab, reads "My Applications", POSTs job-ids to the backend. The one approach that *can* cross same-origin (user grants it `internshala.com` permission). | Must build + ship to the Chrome Web Store (review) + maintain per-browser; user must install it; only works in a browser that has it. |
| **Remote cloud browser** (Browserbase/Steel) | Per-user isolated cloud browser; live-view iframe for the one-time interactive login (user solves any reCAPTCHA — risk-based, real browsers pass invisibly); persistent per-user context; headless reconnect drives "My Applications". | Paid per browser-minute; more moving parts; per-user context lifecycle to manage. |

**Lean:** Gmail email-parsing when we revisit — cheapest, no install, ToS-safe, and lights up
every portal in one shot. The Internshala search client (`portals/internshala/jobs.py`) and the
dormant apply handler (`portals/internshala/apply.py`) remain; only the local-browser
applied-status scraper was removed, so any of the three options above starts from a clean base.

## Good-to-know (not blockers)
- In-memory state isn't shared across workers: the auth TTL cache (`core/auth.py`) and `_manual_search_locks` (`api/routes/jobs.py`) are per-process. Harmless beyond slightly weaker dedupe/cache.
- `core/auth.py` still calls Supabase `get_user` on a cache miss (30s TTL cache added). Fine; optional future improvement is local JWT verification with the Supabase JWT secret.
