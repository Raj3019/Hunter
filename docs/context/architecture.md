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
- `backend/scheduler/` — APScheduler jobs. Calls portal search + AI scoring + DB writes. Not reachable via HTTP.
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
9. Manual Apply now and auto-apply use the approved tailored artifact for that job when present. If no approved tailored artifact exists, they use the latest uploaded base resume.
10. Every application record stores the exact `resume_version` and `tailored_resume_url` used.

MVP output format is `.docx` because Hunter already depends on `python-docx` and most ATS upload forms accept DOCX. After the apply flow is stable, add an optional LaTeX/PDF compile loop for polished recruiter-facing exports, visual preview, and final PDF downloads. The PDF path should be an additive export layer, not a replacement for the DOCX artifact used by ATS upload flows.

## Auth and Access Model

- Every user signs in via Supabase Auth. On login the frontend receives a JWT.
- The JWT is attached as `Authorization: Bearer <token>` on every API request. FastAPI verifies it against Supabase before any handler runs.
- Every database table has a `user_id` column referencing `public.profiles(id)`. All queries are scoped to the authenticated user's `user_id`.
- Portal tokens (Naukri Bearer, Foundit Bearer) are stored per user in `portal_tokens` table. They never appear in any API response after being saved.
- Company portal passwords are encrypted with AES-256 (Fernet) before insert. Decrypted only at the moment of Playwright `page.fill()`. The plaintext is deleted from memory immediately after use (`del password`).
- LinkedIn and Playwright-based portals authenticate via persistent Chrome profile — no password stored. User performs manual login once; the session cookie is reused.

## Apply Modes

- **Manual Apply now**: User-reviewed apply from an approved match. Runs quick pre-apply checks (approval, portal session/token, resume artifact, duplicate status, job availability where supported, questionnaire readiness) and submits through the original portal immediately if blockers are clear. It should not wait for random delay unless a portal-specific hard safety rule requires it.
- **Auto-apply**: User-enabled batch mode. SafeApplyManager controls time window, daily limits, delay spacing, allowed portals, minimum score threshold, and logging. Recommended default window is 9am-8pm IST.

## Invariants

1. **Plain-text passwords never touch the database or logs.** Encrypt immediately on receipt; decrypt only at the moment of browser form fill; delete from memory right after.
2. **No API response ever includes a password, `password_encrypted`, or Bearer token field** after the initial save.
3. **ENCRYPTION_KEY lives only in `.env`** — never in source code, never in git history.
4. **Every apply runs pre-apply checks.** Hunter must confirm approval, portal session/token, resume availability, duplicate status, and job availability where supported before submitting through the source portal.
5. **SafeApplyManager is mode-aware.** Manual Apply now should submit immediately after checks pass. Auto-apply uses SafeApplyManager throttling: per-portal daily caps, user-configured score threshold, safe window, and random delays between successful applies.
6. **Tailored resumes are per-job artifacts.** Generating or approving a tailored resume never overwrites the user's base uploaded resume.
7. **No apply may use an unapproved tailored draft.** Apply routes may use either the latest base resume or an approved tailored artifact tied to that job match.
8. **User must explicitly approve a job match before any apply.** The scheduler only fetches and scores. Auto-apply may submit approved matches only after the user enables auto-apply and configures its limits.
9. **The shared `Job` dataclass lives in `portals/naukri/jobs.py`** and is imported by all other portals. Changing its fields is a cross-portal breaking change.
10. **Proxy rotation is never used.** Naukri's session is bound to the server's Elastic IP. Rotating IPs invalidates the session.
11. **`npm run build` must pass before moving to the next implementation phase.**
