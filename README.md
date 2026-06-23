# Hunter

Hunter is an assist-only job automation web app for Indian job seekers. It parses a resume, searches supported portals, scores jobs against the candidate profile, creates per-job tailored resume drafts, opens the original portal listing, and tracks the final outcome after the user confirms it.

Hunter does not perform broad unattended auto-apply in the current MVP. The active flow is:

1. Upload resume.
2. Save job preferences.
3. Search live portals.
4. Review scored matches.
5. Open the original portal listing.
6. Confirm `I applied` or `Could not apply` in Tracker.

## Stack

| Layer | Tech |
| --- | --- |
| Backend | Python 3.11, FastAPI |
| Frontend | React 18, Vite, Tailwind CSS |
| Database/Auth/Storage | Supabase |
| AI | Anthropic Claude by default, OpenRouter optional |
| Browser automation | Playwright |
| Scheduler | APScheduler, currently disabled at startup |

## Repository Layout

```text
backend/
  main.py                         FastAPI app
  api/routes/                     API routes
  ai/                             resume parsing, scoring, tailoring, Q&A
  core/                           config, auth, database, encryption, storage
  migrations/000_hunter_complete_schema.sql
  portals/                        portal clients and browser flows
  scheduler/                      daily fetch code, disabled by default
  services/                       discovery, tailoring, applied-status sync
frontend/
  src/                            React app
  package.json                    Vite scripts
```

## Prerequisites

- Python 3.11
- Node.js 18+ and npm
- Supabase project
- A text-based PDF resume for testing
- Optional: Anthropic or OpenRouter API key for AI tailoring and full AI parsing

## 1. Create Supabase Project

Create a Supabase project, then open `SQL Editor` and run this single migration file:

```text
backend/migrations/000_hunter_complete_schema.sql
```

That file creates:

- All app tables: `profiles`, `resumes`, `preferences`, `portal_tokens`, `company_accounts`, `jobs`, `job_matches`, `manual_search_runs`, `tailored_resumes`, `applications`
- Auth trigger for `profiles`
- RLS policies
- Indexes and unique keys used by upserts
- Private `resumes` storage bucket and storage policies

The older numbered migrations are kept for historical upgrades. New installs should use `000_hunter_complete_schema.sql`.

## 2. Configure Environment

Create a root `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Generate after installing backend requirements:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
ENCRYPTION_KEY=your-fernet-key

# AI provider. Anthropic is the default.
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-anthropic-key
AI_MODEL=claude-sonnet-4-20250514

# Optional OpenRouter alternative:
# AI_PROVIDER=openrouter
# OPENROUTER_API_KEY=your-openrouter-key
# AI_MODEL=your-openrouter-model-id

FRONTEND_URL=http://127.0.0.1:3000
FRONTEND_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Optional frontend env:

```env
# frontend/.env.local
VITE_API_URL=http://127.0.0.1:8000
VITE_MANUAL_SEARCH_PORTALS=naukri,foundit,internshala
```

Never commit `.env`, portal credentials, API keys, resumes, or Chrome profiles.

## 3. Backend Setup

From the repository root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m playwright install chromium
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected:

```json
{"status":"ok"}
```

## 4. Frontend Setup

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

## 5. First App Run

1. Create an account on `/auth`.
2. Upload a PDF resume from Onboarding or Settings.
3. Save preferences in Settings.
4. Open Jobs and run `Find from profile` or a typed search.
5. Click `Open on <portal>` for a match.
6. Finish on the original portal.
7. Confirm the result in Tracker.

## Portal Notes

- Naukri, Foundit, and Internshala support public search in the current app.
- Naukri and Foundit credentials are optional for search, but required for durable applied-status sync.
- Wipro, HCLTech, Infosys, and Capgemini career credentials are used for read-only applied-status import.
- Internshala, Workday, Taleo, TCS, Cognizant, and other company/ATS flows are manual-confirm unless explicitly verified.
- Broad auto-submit remains dormant in the MVP.

## AI Notes

- Resume parsing has a local fallback if the AI provider is missing or unavailable.
- Interactive manual search uses fast local scoring for speed.
- Resume tailoring requires a working AI provider key.
- The default model is `claude-sonnet-4-20250514`.

## Verification Commands

Backend syntax check:

```powershell
cd backend
python -m py_compile main.py api\routes\jobs.py api\routes\applications.py services\job_discovery.py services\tailored_resume_service.py
```

Frontend build:

```powershell
cd frontend
npm run build
```

Inspect manual-search prerequisites without running live portal search:

```powershell
cd backend
python test_manual_search.py
```

Run live manual search smoke only when Supabase env and a test user are ready:

```powershell
cd backend
$env:RUN_MANUAL_SEARCH_FULL="1"
$env:HUNTER_TEST_EMAIL="your-test-user@example.com"
$env:HUNTER_TEST_SEARCH_QUERY="frontend developer"
$env:HUNTER_TEST_SEARCH_LOCATION="Pune"
$env:HUNTER_TEST_RESULTS_PER_PAGE="3"
python test_manual_search.py
```

## Common Issues

| Problem | Fix |
| --- | --- |
| `Missing required environment variable` | Check root `.env`; backend imports `core.config` at startup. |
| Resume upload fails | Confirm the `resumes` bucket exists. The complete migration creates it. |
| Tailoring fails | Configure `ANTHROPIC_API_KEY` or OpenRouter env vars. |
| Search returns generic results | Add resume or preferences, or type a specific role query. |
| Supabase upsert fails on conflict | Re-run `000_hunter_complete_schema.sql` and confirm unique indexes exist. |
| Portal sync says reconnect required | Saved portal credentials failed silent re-login; reconnect from Portals. |

## Production Notes

This project is local/dev oriented right now. Before hosting for real users, review:

- CORS and HTTPS
- Supabase RLS and service role key handling
- `ENCRYPTION_KEY` storage and rotation plan
- Scheduler ownership if daily fetch is re-enabled
- Portal rate limits and Naukri IP/session behavior
- Cleanup of seeded/test data

## Safety Rules

- Never store or log plain-text passwords.
- Never return `password_encrypted` or bearer tokens in API responses.
- Keep `ENCRYPTION_KEY` only in environment configuration.
- No unattended apply without explicit verified portal flow and user approval.
- Treat source portals as the source of truth for final application availability.

