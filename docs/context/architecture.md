# Architecture Context

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Backend framework | Python 3.11 + FastAPI | Async API server, APScheduler for daily cron |
| Frontend | React 18 + Tailwind CSS | SPA, 4 pages: Onboarding, Dashboard, Tracker, Settings |
| Auth | Supabase Auth (JWT) | User sign-up/login; JWT passed in Authorization header |
| Database | PostgreSQL via Supabase | Metadata, job snapshots, job matches, application status, portal tokens |
| File storage | Supabase Storage | Uploaded PDF resumes, generated tailored resume files |
| AI | Claude API (`claude-sonnet-4-20250514`) | Resume parsing, job scoring, resume tailoring, Q&A answering |
| Browser automation | Playwright (primary) | LinkedIn, Internshala apply, Workday, Taleo, company portals |
| Stealth browser | Nodriver | Sites with aggressive bot detection (Indeed India) |
| HTTP client | httpx (async) / requests (scripts) | Naukri, Foundit, Internshala internal API calls |
| TLS fingerprint | curl_cffi | Fallback when httpx gets TLS-fingerprint blocked |
| Adaptive scraping | Scrapling + StealthyFetcher | Company career pages with no API |
| PDF extraction | pdfplumber (primary) + pypdf (fallback) | Extract resume text before sending to Claude |
| Resume output | python-docx | Generate tailored resume as .docx |
| Scheduling | APScheduler | Daily job fetch at 8am IST (replace with Celery+Redis at scale) |
| Encryption | cryptography.fernet (AES-256) | Encrypt company portal passwords at rest |
| Notifications | Twilio WhatsApp + Resend (email) | Alerts, daily digest |
| Hosting | AWS EC2 t2.micro + Elastic IP | Single server; Elastic IP required for Naukri session binding |

## System Boundaries

- `backend/portals/` — All portal-specific logic: auth, job search, apply. Each portal is a self-contained module. The only cross-portal dependency is the shared `Job` dataclass defined in `portals/naukri/jobs.py` and reused by all other portals.
- `backend/ai/` — All Claude API calls. No portal logic here; receives plain dicts and returns plain dicts or strings.
- `backend/api/` — FastAPI route handlers and Pydantic models. Thin layer: validate input, call portals or AI modules, persist to DB, return response.
- `backend/core/` — Shared infrastructure: env config, Supabase client, Fernet encryption. No business logic.
- `backend/scheduler/` — APScheduler jobs. Calls portal search + AI scoring + DB writes for background discovery. Not reachable via HTTP except the admin trigger.
- `backend/services/job_discovery.py` — Shared job discovery orchestration for manual search and scheduler search: load user context, call portal search clients, dedupe, score, upsert jobs, and save matches. Route handlers and scheduler jobs should use this service instead of duplicating scoring/upsert logic.
- `frontend/src/` — React SPA. Communicates only with the FastAPI backend via `api/client.js`. No direct portal or DB access.
- `chrome_profiles/` — Persistent Playwright browser profiles, one per portal/company. Session state lives here; never commit to git.

## Storage Model

- **PostgreSQL (Supabase)**: All structured metadata - user profiles, preferences, parsed resume data (jsonb), portal tokens (bearer tokens, profile IDs), fetched job snapshots, AI-scored job matches (with score + reasons), tailored resume draft metadata, and application records with status.
- **Job snapshots**: Hunter stores portal, portal job ID, title, company, location, salary, experience, description, tags, apply link, and fetched time for review, dedupe, scoring, and tracker history. The source portal remains the source of truth for final availability and submission.
- **Supabase Storage (blob)**: Original uploaded PDF resumes and generated tailored resume `.docx` files. File URLs stored in the database; large content never written directly to DB columns.
- **Chrome profiles (local disk)**: Playwright persistent browser sessions at `./chrome_profiles/<portal>/`. One directory per portal. Contains cookies and local storage — equivalent to a saved browser login. Must be kept on the same machine (Elastic IP) to avoid session invalidation.

## Tailored Resume Artifact Lifecycle

Hunter treats tailoring as a per-job draft artifact flow, not as a silent mutation of the user's base resume.

1. User clicks **Tailor** on a specific job match.
2. Backend loads the latest uploaded resume, parsed resume data, match score context, and job snapshot.
3. AI returns structured tailoring output: tailored summary, reordered skills, highlighted experience bullets, changes made, and warnings.
4. Backend validates the output against the original resume. Any invented skill, employer, date, title, or unsupported claim must be blocked, removed, or surfaced as a warning.
5. Backend generates a `.docx` draft with `python-docx` and stores it in Supabase Storage under the user's folder.
6. Backend inserts a `tailored_resumes` row with `status='draft'`, `source_resume_id`, `match_id`, `file_url`, `file_type`, `version`, `tailoring_json`, and `validation_json`.
7. Frontend shows the draft version, summary of changes, warnings, matched/missing skills, and preview/diff. The base resume remains unchanged.
8. User clicks **Approve tailored resume**. Backend marks the draft as `approved` and copies its `file_url`/`version` onto the `job_matches` row.
9. MVP portal-open tracking records the approved tailored artifact for that job when present. If no approved tailored artifact exists, it records the latest uploaded base resume.
10. Every portal-pending or completed application record stores the exact `resume_version` and `tailored_resume_url` used.

MVP output format is `.docx` because Hunter already depends on `python-docx` and most ATS upload forms accept DOCX. After the apply flow is stable, add an optional LaTeX/PDF compile loop for polished recruiter-facing exports, visual preview, and final PDF downloads. The PDF path should be an additive export layer, not a replacement for the DOCX artifact used by ATS upload flows.

## Deployment & Production Readiness

- **Current status: local/dev only** (server runs on the owner's own machine, effectively single user). Multi-user production deployment is intentionally deferred.
- The durable Naukri credential login (encrypted password in `portal_tokens`, browserless API re-login via `get_valid_naukri_auth`) is production-compatible and behaves the same on a server.
- Before deploying for real users, work through **`docs/context/production-readiness.md`** — the deferred checklist. Headlines: run APScheduler in exactly one process, plan for Naukri's single-IP anti-bot limits, and lock down `ENCRYPTION_KEY` + Supabase RLS + CORS/HTTPS. (The local-only `headless=False` browser-login flows — Naukri guided connect + Internshala browser-connect — have already been removed; the credential form is the only Naukri connect path.)

## Auth and Access Model

- Every user signs in via Supabase Auth. On login the frontend receives a JWT.
- The JWT is attached as `Authorization: Bearer <token>` on every API request. FastAPI verifies it against Supabase before any handler runs.
- Every database table has a `user_id` column referencing `public.profiles(id)`. All queries are scoped to the authenticated user's `user_id`.
- Portal tokens such as Foundit Bearer tokens are stored per user in `portal_tokens` table. They never appear in any API response after being saved.
- Naukri keyword search uses the public `/jobapi/v3/search` endpoint and needs no login. A Naukri login is optional and only powers personalized recommendations and authed apply.
- Naukri durable login uses encrypted credential re-login, not a saved token or browser profile. Naukri's `nauk_at` Bearer token is a 1-hour JWT and Naukri logs a browser profile out once it lapses (purging the long-lived `nauk_rt` refresh cookie), so a saved token/profile cannot stay valid for days. Hunter stores the user's Naukri credentials encrypted (Fernet) and silently re-logs in to mint a fresh token when the cached one expires. See `03-naukri-portal.md` → "Durable Authentication". The guided browser-login flow has been **removed** — the credential form is the only Naukri connect path.
- Company portal passwords are encrypted with AES-256 (Fernet) before insert. Decrypted only at the moment of Playwright `page.fill()`. The plaintext is deleted from memory immediately after use (`del password`).
- Internshala uses a **manual login link** — the user logs in in their own browser; Hunter stores no server-side Internshala session (the old persistent-Chrome-profile browser-connect flow was removed). The dormant Workday/Taleo/company apply handlers would use a persistent Chrome profile if ever enabled.

## Job Discovery Modes

- **Manual Job Search**: User-triggered foreground search from the Jobs/top-bar search field. It calls `POST /api/jobs/search`, uses public Naukri search plus any connected token-backed sources, fetches jobs from saved preferences by default, allows a typed role query as a one-time override, scores jobs against the resume, saves matches, and refreshes the review queue.
- **Daily Scheduler**: Background discovery run at 8am IST. It uses saved preferences as the fetch criteria, public Naukri search plus connected portals, and the same resume-based scoring helpers, but it should not be confused with the top-bar search command.
- **Recommended feeds**: Optional enrichment only. If Naukri recommendations return 401 while normal `/jobapi/v3/search` works, Hunter logs the recommendation failure and continues search.

Manual search and scheduler are allowed to create the same type of `job_matches` rows. The row metadata should preserve `search_source` (`manual` or `scheduler`), search query/location, and optional search run id so support/debugging can explain where a match came from.

## Portal Action Modes

- **MVP Open portal**: User-reviewed action from a curated match. Hunter records a portal-pending application task, stores the original source URL and resume artifact metadata, opens the portal page, and waits for the user to confirm the outcome in Tracker. It does not submit forms unattended.
- **Future verified auto-submit**: Dormant code path only. It may be re-enabled later for explicitly verified official/native flows and must use SafeApplyManager throttling, per-portal caps, score threshold, safe window, and audit logging.

## Applied-Status Auto-Detect

Read-only reconcilers advance Hunter's `external_pending` portal-open tasks to `applied` / `viewed` / `interview` by reading the portal's own applied history — so the user usually does not have to tap "I applied" manually. Each `reconcile_*_applications(db, user_id)` matches the portal's applied-list job ids against the stored `jobs.job_id` of the user's pending tasks; it never submits anything. Exposed as `POST /api/applications/sync-{naukri,foundit,internshala}` and fired together (throttled) from the frontend `syncAppliedStatus` (on tracker open, tab focus, and interval), with a success toast when anything flips.

**Feasibility rule — auto-detect needs one account = one unified applied list (an aggregator job board).** That splits the portals into:

| Mechanism | Portals | Notes |
|---|---|---|
| **API** (fast, no browser) | Naukri, Foundit | Reverse-engineered JSON history APIs. Naukri = encrypted-credential re-login; Foundit = base64-decoded JWT + `MSUID`/`MSSOAT` cookies + `x-source-site-context` header. |
| **Browser** (Playwright, heavy) | Internshala | Login is reCAPTCHA-gated → no API. Scrapes the persistent Chrome profile's "My Applications"; reconcile throttled server-side (`COOLDOWN_SECONDS=600`). LinkedIn could work the same way (unified "My Jobs → Applied") but isn't built. |
| **Company career portals** (headless login, per-tenant) | Wipro, HCLTech, Infosys, Capgemini | Single-employer sites where the candidate has a clean email+password login and a readable "My Applications" list. Dispatched by `portals/career_portals.py`: **SuccessFactors** (`portals/successfactors/` — Wipro `wiprolimitP2`, HCLTech `HCLPRD` on `career55.sapsf.eu`; Capgemini `capgemitecP3` on `career5.successfactors.eu`) logs in headless and reads the `getCandidateProfileVO` DWR response; **Infosys** (`portals/infosys/` — `career.infosys.com`) logs in via Keycloak email+password (no OTP/reCAPTCHA — verified live) and reads the `getCandidateApplications` REST JSON. Shared reconcile `services/career_apply_sync.py` throttled server-side (`COOLDOWN_SECONDS=300`), matches pending tasks by normalized job title. Adding an employer is a registry entry (+ tenant config for a new SF site, or a new platform branch). |
| **Manual-confirm only** | Workday, Taleo, TCS, Cognizant, Accenture, any other company/ATS site | Logins can't be replayed server-side or there's no central list: TCS (image-CAPTCHA + email OTP) and Cognizant (passwordless magic-link + Google SSO + reCAPTCHA) verified live; others scatter applications across separate per-company systems. The one-tap "I applied / Could not apply" confirm is the correct design. |

Note also (per `naukri-solutions.md`): even on an API portal, **external/company-site applies** (Naukri `companyApplyJob:True`) submit on the company's own ATS and never enter the portal's history, so they also fall to manual-confirm.

## Invariants

1. **Plain-text passwords never touch the database or logs.** Encrypt immediately on receipt; decrypt only at the moment of use (browser form fill, or the Naukri credential re-login HTTP call); delete from memory right after (`del password`).
2. **No API response ever includes a password, `password_encrypted`, or Bearer token field** after the initial save.
3. **ENCRYPTION_KEY lives only in `.env`** — never in source code, never in git history.
4. **MVP never submits unattended.** Hunter opens the source portal and records `external_pending` until the user confirms the outcome.
5. **SafeApplyManager is dormant for MVP auto-submit.** Keep it available for future verified flows, but do not expose broad auto-apply in the UI.
6. **Tailored resumes are per-job artifacts.** Generating or approving a tailored resume never overwrites the user's base uploaded resume.
7. **No portal task may claim an unapproved tailored draft.** Portal-open tracking may reference either the latest base resume or an approved tailored artifact tied to that job match.
8. **The scheduler never submits applications.** It only fetches, scores, dedupes, and saves curated matches.
9. **Manual search never applies.** It may fetch from preferences, score against the resume, dedupe, save, and refresh matches only. Tailor/Open portal/Confirm remains a separate user-reviewed path.
10. **The shared `Job` dataclass lives in `portals/naukri/jobs.py`** and is imported by all other portals. Changing its fields is a cross-portal breaking change.
11. **Naukri durable auth is credential-based, not token/profile-based.** The `nauk_at` Bearer is a 1-hour JWT and the browser profile cannot retain a session across that gap (Naukri logs it out and purges `nauk_rt`). Search/status/apply code must obtain a live client via `get_valid_naukri_auth()`, which reuses the cached token while its JWT is unexpired and otherwise silently re-logs in from the encrypted stored credentials. Connection status is reported honestly from the cached token expiry plus credential presence — never hardcoded "connected".
12. **Proxy rotation is never used.** Naukri's session is bound to the server's Elastic IP. Rotating IPs invalidates the session.
13. **`npm run build` must pass before moving to the next implementation phase.**
