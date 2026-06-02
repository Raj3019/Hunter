# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Project Is

A job automation web app that:
1. Takes the user's resume + job preferences
2. Searches jobs across multiple Indian job portals (Naukri, Foundit, Internshala, LinkedIn, Workday sites, Taleo sites, TCS, Infosys, etc.)
3. Scores jobs against the resume using AI
4. Tailors resumes per job description (user approves before apply)
5. Applies automatically with safe rate limiting
6. Tracks every application in a dashboard

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11 + FastAPI |
| Frontend | React 18 + Tailwind CSS |
| Database | PostgreSQL via Supabase |
| AI | Claude API (`Claude-sonnet-4-20250514`) |
| Browser automation | Playwright (primary), Nodriver (anti-bot), Camoufox (last resort) |
| Job scheduler | APScheduler (daily fetch at 8am IST) |
| Notifications | Twilio WhatsApp API |
| Auth | Supabase Auth (JWT) |
| Hosting | AWS EC2 t2.micro + Elastic IP |
| Encryption | cryptography.fernet (AES-256) |

## Project Structure

```
job-automation/
├── backend/
│   ├── main.py                      # FastAPI app, APScheduler startup
│   ├── requirements.txt
│   ├── .env                         # never commit
│   ├── core/
│   │   ├── config.py
│   │   ├── database.py              # Supabase connection
│   │   └── encryption.py           # Fernet encrypt/decrypt for passwords
│   ├── portals/
│   │   ├── base.py                  # SafeApplyManager — rate limits + delays
│   │   ├── naukri/                  # Reverse-engineered internal API
│   │   ├── foundit/                 # Reverse-engineered internal API
│   │   ├── internshala/             # API search + Playwright apply
│   │   ├── linkedin/                # Playwright only (persistent Chrome profile)
│   │   ├── workday/                 # Playwright (covers 100+ companies)
│   │   ├── taleo/                   # Playwright (covers HCL, Oracle, etc.)
│   │   └── custom/
│   │       ├── registry.py          # Central registry of company portals
│   │       ├── account_login.py     # Playwright login handler
│   │       ├── company_apply.py     # Apply flow for company portals
│   │       ├── tcs.py
│   │       ├── infosys.py
│   │       └── accenture.py
│   ├── ai/
│   │   ├── resume_parser.py
│   │   ├── job_scorer.py
│   │   ├── resume_tailor.py
│   │   └── qa_answerer.py           # answers job questionnaires using AI
│   ├── api/
│   │   ├── routes/                  # auth, resume, preferences, jobs, applications, portals, company_accounts
│   │   └── models/                  # user, job, application Pydantic models
│   └── scheduler/
│       └── daily_fetch.py
├── frontend/
│   └── src/
│       ├── pages/                   # Onboarding, Dashboard, Tracker, Settings
│       ├── components/              # JobCard, ResumePreview, PortalConnect
│       └── api/client.js            # axios instance with JWT interceptor
└── docker-compose.yml
```

## Development Commands

```bash
# Backend
cd backend
pip install -r requirements.txt
playwright install chromium
uvicorn main:app --reload

# Run a specific test script (pattern used throughout the plan)
python test_naukri.py

# Frontend
cd frontend
npm install
npm start        # dev server on localhost:3000
npm run build    # must pass before moving to next phase
```

## Portal Approach Map

| Portal | Approach |
|---|---|
| Naukri | Reverse-engineered internal JSON API; nkparam header required for search |
| Foundit | Reverse-engineered internal JSON API |
| Internshala | Internal API for search; Playwright for apply form |
| LinkedIn | Playwright only — persistent Chrome profile (user logs in manually once) |
| Workday sites | Playwright — one generic handler covers 100+ companies |
| Taleo sites | Playwright — iframes; one handler covers HCL, Oracle, etc. |
| TCS / Infosys / company portals | Playwright + saved (encrypted) credentials |
| Indeed India | Nodriver (heavy bot detection) |

## Architecture Invariants

1. **Never store or log plain-text passwords.** Encrypt with `core/encryption.py` (Fernet) immediately when received from the frontend. Decrypt only at the moment of actual Playwright `fill()` call, then `del password`.
2. **Never return a password or `password_encrypted` field in any API response.**
3. **ENCRYPTION_KEY lives only in `.env` — never in source code or git.**
4. **Rate limits and human-like delays are enforced in `SafeApplyManager` (base.py).** Per-portal daily limits and random delays (30–180 seconds) between applies. Apply only 9am–8pm IST.
5. **No apply without user approval.** Jobs flow: fetched → scored → user approves → apply queued.
6. **nkparam (Naukri search header) is generated per-request.** If native generation fails, fall back to Playwright-intercept method in `nkparam.py`.
7. **`npm run build` must pass before moving to the next implementation phase.**

## Key API Routes

```
POST /api/resume/upload
GET  /api/resume/parsed
POST /api/preferences
GET  /api/preferences
POST /api/portals/naukri/token
GET  /api/portals/status
GET  /api/jobs/matches
POST /api/jobs/{id}/approve
POST /api/jobs/{id}/skip
POST /api/jobs/{id}/tailor
POST /api/jobs/{id}/apply
GET  /api/applications
PATCH /api/applications/{id}
POST /api/company-accounts
GET  /api/company-accounts
GET  /api/company-accounts/{company_key}/status
DELETE /api/company-accounts/{company_key}
```

## AI Layer

All AI calls use `anthropic` SDK with `Claude-sonnet-4-20250514`. The four AI modules:
- `resume_parser.py` — extracts structured JSON from PDF text
- `job_scorer.py` — returns 0–100 score + matched/missing skills; recommend apply if ≥ 60
- `resume_tailor.py` — rewrites summary + reorders skills to match JD; never invents new experience
- `qa_answerer.py` — short direct answers for application questionnaire fields

## Browser Automation Strategy

- **Playwright** is the primary tool for all form interactions.
- Use **persistent Chrome profiles** (`./chrome_profiles/<portal>/`) so sessions survive between runs. User logs in manually once; automation reuses that session.
- **Nodriver** replaces Playwright for sites with aggressive WebDriver detection (Indeed India). Falls through to **Camoufox** (Firefox, C++ level fingerprint spoofing) only if Nodriver also fails.
- All browser automation runs `headless=False` by default for login flows so unexpected popups can be seen.

## Implementation Order

See `docs/job-automation-implementation new.md` for the full phase-by-phase implementation guide with complete code snippets. Phases must be done in order — each portal test must fully pass before moving to the next:

1. Naukri API client + test script
2. FastAPI + Supabase schema + resume upload/parser
3. AI scorer/tailor + Foundit + APScheduler
4. React frontend (4 pages)
5. LinkedIn + Internshala
6. Workday automation
7. Taleo + TCS iBegin + Infosys
8. Company account login/apply (Phase 12) — encrypted credentials
9. End-to-end testing + AWS EC2 deploy

## Context Files

The `docs/context/` directory contains template files (`project-overview.md`, `architecture.md`, `code-standards.md`, `ui-context.md`, `ai-workflow-rules.md`, `progress-tracker.md`) that must be filled in as the project progresses. Update `progress-tracker.md` after every meaningful implementation change.
