# Feature Spec 17 - Manual Job Search

## What This Is

Manual Job Search turns the top-bar search field into a real user-triggered search command. When the user clicks Find with an empty search box, Hunter fetches jobs from saved preferences. When the user types a role such as "backend developer", that text becomes a one-time role override. In both cases, Hunter scores the returned jobs against the user's resume, saves qualified matches, and refreshes the Jobs review queue.

This is separate from the daily scheduler. The scheduler is background discovery at 8am IST. Manual search is foreground discovery controlled by the user.

Manual search fetches, deduplicates, scores, and saves matches only. It must never apply to a job by itself.

## Reference

Use Traverser25/NopeRi as a Naukri API reference, not as copy-paste source:

- Repository: https://github.com/Traverser25/NopeRi
- Its README marks Naukri job search through `/jobapi/v3/search` as working as of May 2026.
- It documents the `nkparam` requirement for Naukri search and keeps recommended jobs as a separate feed.
- It treats search keyword, location, experience, page count, job freshness, score threshold, and duplicate tracking as configurable search-run inputs.

Hunter implementation rule: keep the existing `backend/portals/naukri/` client as the source of truth, but compare request parameters, headers, and response parsing against NopeRi when Naukri search breaks.

## User Flow

1. User opens Jobs.
2. User either leaves the top search field blank to use saved preferences or types a one-time query such as `backend developer`.
3. User optionally chooses location, experience, portals, max pages, and minimum score. If omitted, Hunter uses saved preferences.
4. User clicks Find/Search or presses Enter.
5. Frontend shows "Finding Naukri jobs..." and disables duplicate submits for the same query/profile run.
6. Backend validates that the user has a parsed resume and at least one connected portal.
7. Backend searches the selected portals. MVP: Naukri only.
8. Backend deduplicates against existing `jobs` and `job_matches`.
9. Backend scores new jobs through the AI scorer.
10. Backend saves matches at or above the requested minimum score.
11. Frontend refreshes `/api/jobs/matches` and shows a result summary.

## Product Rules

- The search bar must not be cosmetic. Empty submit runs from saved profile preferences; typed text runs as a one-time role override.
- Manual search should not overwrite saved preferences unless the user explicitly enables "Save as preferences".
- Manual search uses saved preferences as the default fetch criteria: skills, job titles, locations, work type, salary, experience, and avoid-list.
- The AI score, matched skills, missing skills, and reasons are resume-based. Preferences decide which jobs to fetch/focus, not what skills the candidate is credited with.
- Manual search results enter the same Jobs review queue as scheduler results.
- Manual search results should be tagged internally as `search_source='manual'` so debugging can distinguish them from scheduler matches.
- Recommended jobs are optional enrichment. A 401 from Naukri recommended jobs must not fail manual search if `/jobapi/v3/search` works.
- Applying remains a separate user action: Tailor, Open portal, then confirm the outcome in Tracker.

## Backend API

### `POST /api/jobs/search`

Authenticated. Starts one on-demand search and returns a summary after fetch, score, and save complete.

Request:

```json
{
  "query": "",
  "locations": ["Bengaluru", "Remote India"],
  "experience_years": 3,
  "portals": ["naukri"],
  "max_pages": 2,
  "results_per_page": 20,
  "min_score": 60,
  "freshness_days": 30,
  "save_as_preferences": false
}
```

Response:

```json
{
  "success": true,
  "run": {
    "id": "uuid",
    "status": "completed",
    "query": "Frontend Engineer",
    "skills": ["React", "TypeScript"],
    "work_type": ["remote", "hybrid"],
    "portals": ["naukri"],
    "fetched_count": 36,
    "new_jobs_count": 18,
    "scored_count": 18,
    "saved_matches_count": 5,
    "min_score": 60
  },
  "matches": [
    {
      "id": "job_match_uuid",
      "match_score": 82,
      "status": "pending",
      "jobs": {
        "portal": "naukri",
        "title": "Backend Developer",
        "company": "Example",
        "location": "Bengaluru"
      }
    }
  ],
  "warnings": []
}
```

Failure responses:

| Status | Cause | User-facing message |
| --- | --- | --- |
| `400` | Query is empty and no saved job title or skill exists | Enter a job title or save profile preferences first. |
| `400` | `max_pages` or `results_per_page` too high | Reduce search size. |
| `401` | JWT expired | Sign in again. |
| `409` | Same query is already running for this user | Search is already running. |
| `422` | No parsed resume | Upload and parse your resume first. |
| `424` | Selected portal is not connected | Connect Naukri before searching it. |

Implementation note: keep the first MVP synchronous and capped (`max_pages <= 3`, `results_per_page <= 20`) so the UI can wait on one request. If multi-portal searches become slow, keep the same request body but return `202` with `run.id` and add `GET /api/jobs/search/runs/{run_id}` polling.

## Backend Implementation

Create a shared search service so scheduler and manual search do not duplicate scoring/upsert logic:

```text
backend/services/job_discovery.py
  load_user_search_context(user_id)
  search_portals(user_id, query, locations, experience_years, portals, max_pages)
  score_and_save_matches(user_id, jobs, resume, min_score, source, search_run_id, query)
```

Implementation file: `backend/services/job_discovery.py`.

Manual route responsibilities:

1. Validate request and user prerequisites.
2. Insert a `manual_search_runs` row with `status='running'`.
3. Build portal clients for the requested public/token-backed sources.
4. For Naukri, use unauthenticated `NaukriAuthClient()` with `NaukriJobClient.search_jobs()`; do not refresh or require a browser profile in the MVP.
5. Search each requested page and location.
6. Deduplicate by `portal:job_id`.
7. Score only new or stale matches.
8. Upsert `jobs` and `job_matches`.
9. Update `manual_search_runs` to `completed` or `failed`.
10. Return a compact summary and the top newly saved matches.

Naukri-specific rules:

- Use `/jobapi/v3/search` as the primary manual search endpoint.
- Generate or capture `nkparam` per request/page.
- Keep recommended jobs optional. Do not call recommended jobs in the initial manual search route unless a later UI explicitly asks for "recommendations".
- Preserve `apply_link`, Naukri portal job id, description, tags, questionnaire flags, and any Easy Apply fields needed by `apply_job()`.
- Never log Bearer tokens, cookies, or captured browser session data.

## Database

Recommended migration:

Implementation file: `backend/migrations/003_manual_job_search.sql`.

```sql
alter table public.job_matches
  add column if not exists search_source text default 'scheduler',
  add column if not exists search_query text,
  add column if not exists search_location text,
  add column if not exists search_run_id uuid,
  add column if not exists last_scored_at timestamp default now();

create table if not exists public.manual_search_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  query text not null,
  locations text[] default '{}',
  portals text[] default '{}',
  experience_years integer default 0,
  min_score integer default 60,
  max_pages integer default 1,
  status text default 'running',
    -- 'running', 'completed', 'failed', 'cancelled'
  fetched_count integer default 0,
  new_jobs_count integer default 0,
  scored_count integer default 0,
  saved_matches_count integer default 0,
  warnings text[] default '{}',
  error text,
  started_at timestamp default now(),
  finished_at timestamp
);

create index if not exists idx_manual_search_runs_user_started
  on public.manual_search_runs(user_id, started_at desc);

create index if not exists idx_job_matches_search_run
  on public.job_matches(search_run_id);
```

If the migration is deferred for the first code patch, manual search can still save matches through the existing `jobs` and `job_matches` tables. Add the columns before production so support/debugging can explain why a match appeared.

## Frontend UX

Top bar:

- Replace placeholder search behavior with a real command.
- Search input placeholder: `Find from profile, or type a role`.
- Pressing Enter or clicking Find/Search calls `POST /api/jobs/search`.
- While the request runs, show a compact spinner and disable the Find/Search action.
- After completion, refresh matches, applications counts, and ready counts.
- On blocker, open the relevant setup route: resume upload, preferences, or portal connect.

Jobs page:

- Add optional inline filters for location, experience, portal, and minimum score.
- Show "Using saved preferences" when location/experience are inherited.
- Show "Save as preferences" as an explicit checkbox or menu item.
- Show a result summary after search: `5 matches saved from 36 Naukri jobs`.
- Keep existing review actions: Tailor, Open portal, Skip, and Tracker confirmation.

Empty states:

- No resume: "Upload your resume before scoring recommended jobs."
- No connected portal: "Connect Naukri to search live jobs."
- No results fetched: "No Naukri jobs found for this query."
- Jobs fetched but no score >= threshold: "Jobs were found, but none met your current score threshold."

## Safety And Rate Limits

- Cap MVP manual search to 3 pages per portal per request.
- Add a per-user cooldown, for example one manual search every 30 seconds.
- Do not run manual search automatically on every keystroke.
- Do not use proxy rotation.
- Keep Naukri requests on the same backend machine/IP as the connected browser profile.
- Store only job snapshots, run metadata, and match scores. Do not store raw auth headers.

## Testing

Backend:

```bash
cd backend
python test_ai_layer.py
python test_manual_search.py
```

Suggested `test_manual_search.py` checks:

1. Rejects when no query and no saved preference title exist.
2. Rejects when resume is missing.
3. Rejects when Naukri is not connected.
4. With connected Naukri and AI provider configured, searching `backend developer` returns a run summary.
5. Saved matches appear in `/api/jobs/matches`.
6. Repeating the same query does not duplicate existing `jobs` rows.

Frontend:

```bash
cd frontend
npm run build
```

Manual verification:

1. Type `backend developer` in the top search.
2. Click Search.
3. Confirm the UI shows searching state.
4. Confirm new Naukri matches appear in Jobs.
5. Confirm no application is created until the user explicitly approves and applies a match.

## Acceptance Criteria

- The top search bar performs a real backend search.
- Naukri manual search uses connected portal auth and `/jobapi/v3/search`.
- Manual search result rows are saved as normal `job_matches`.
- Search failures show setup/actionable blockers, not silent empty screens.
- The daily scheduler still works independently.
- Manual search never applies to a job by itself.
