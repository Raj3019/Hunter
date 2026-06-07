# Feature Spec 01 — Database Schema (Supabase)

## What This Is

Set up the entire PostgreSQL schema on Supabase that the whole app depends on. Every table, relationship, and index is defined here. This is the first thing to do — nothing else can be built without it.

## Prerequisites

- Supabase project created (free tier is fine)
- Supabase project URL and anon key saved in `.env`
- No existing tables (fresh project)

## Environment Variables Needed

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## Implementation Steps

### Step 1 — Open Supabase SQL Editor

Go to your Supabase project → SQL Editor → New query. Paste and run each block below in order.

---

### Step 2 — Profiles Table (extends Supabase auth.users)

```sql
create table public.profiles (
  id uuid references auth.users primary key,
  email text not null,
  full_name text,
  phone text,
  is_admin boolean default false,
  created_at timestamp default now()
);

-- Auto-create profile when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

---

### Step 3 — Resumes Table

```sql
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  file_url text,              -- Supabase Storage URL of original PDF
  parsed_data jsonb,          -- structured JSON from Claude parse
  raw_text text,              -- full extracted text (for tailoring)
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index idx_resumes_user_id on public.resumes(user_id);
```

---

### Step 4 — Preferences Table

```sql
create table public.preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade unique,
  skills text[] default '{}',
  job_titles text[] default '{}',
  locations text[] default '{}',
  work_type text[] default '{}',    -- 'remote', 'hybrid', 'onsite'
  min_salary integer default 0,
  max_salary integer default 0,
  experience_years integer default 0,
  avoid_companies text[] default '{}',
  auto_apply_enabled boolean default false,
  auto_apply_daily_limit integer default 10,
  auto_apply_min_score integer default 75,
  auto_apply_allowed_portals text[] default '{}',
  safe_apply_start_time time default '09:00',
  safe_apply_end_time time default '20:00',
  require_tailored_resume_approval boolean default true,
  updated_at timestamp default now()
);
```

---

### Step 5 — Portal Tokens Table

```sql
create table public.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  portal text not null,              -- 'naukri', 'foundit', 'internshala', 'linkedin'
  bearer_token text,                 -- for API-based portals
  profile_id text,                   -- Naukri profileId, Foundit userId
  chrome_profile_path text,          -- path for Playwright-based portals
  expires_at timestamp,
  created_at timestamp default now(),
  unique(user_id, portal)
);

create index idx_portal_tokens_user_portal on public.portal_tokens(user_id, portal);
```

---

### Step 6 — Company Accounts Table (for portals requiring login)

```sql
create table public.company_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  company_key text not null,         -- 'tcs', 'infosys', 'cognizant', 'wipro', 'hcl'
  company_name text not null,
  login_url text,
  signup_url text,
  username text,                     -- their email on that portal
  password_encrypted text,           -- AES-256 Fernet encrypted — NEVER plain text
  account_status text default 'needs_setup',
    -- 'needs_setup', 'active', 'manual_only', 'expired'
  chrome_profile_dir text,
  last_login_at timestamp,
  created_at timestamp default now(),
  unique(user_id, company_key)
);
```

---

### Step 7 — Jobs Table (all fetched jobs across all portals)

Hunter stores job snapshots for review, scoring, dedupe, and tracker history. The source portal remains the source of truth for final availability and submission.

```sql
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  portal text not null,              -- 'naukri', 'foundit', 'linkedin', 'workday', etc.
  job_id text not null,              -- portal's own ID
  title text,
  company text,
  location text,
  description text,
  salary text,
  experience text,
  tags text[] default '{}',
  apply_link text,
  apply_method text default 'unknown',
    -- 'unknown', 'native', 'external', 'ats_supported'
  external_apply_url text,
  portal_metadata jsonb default '{}'::jsonb,
  posted_date text,
  is_workday boolean default false,
  is_taleo boolean default false,
  has_questionnaire boolean default false,
  fetched_at timestamp default now(),
  last_seen_at timestamp default now(),
  source_status text default 'active',
    -- 'active', 'closed', 'unknown'
  unique(portal, job_id)
);

create index idx_jobs_portal on public.jobs(portal);
create index idx_jobs_fetched_at on public.jobs(fetched_at desc);
```

---

### Step 8 — Job Matches Table (scored per user)

```sql
create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  match_score integer not null,                -- 0-100
  match_reasons text[] default '{}',
  matched_skills text[] default '{}',
  missing_skills text[] default '{}',
  status text default 'pending',
    -- 'pending', 'approved', 'skipped', 'applied', 'blocked', 'needs_review'
  tailored_resume_url text,                    -- approved tailored artifact URL used by apply
  tailored_resume_approved boolean default false,
  tailored_resume_version text,
  created_at timestamp default now(),
  unique(user_id, job_id)
);

create index idx_job_matches_user_status on public.job_matches(user_id, status);
create index idx_job_matches_score on public.job_matches(match_score desc);
```

---

### Step 8b - Manual Search Metadata

Manual searches and scheduled searches both create normal `job_matches` rows. Add lightweight source metadata so the UI/support layer can explain where a match came from.

```sql
alter table public.job_matches
  add column if not exists search_source text default 'scheduler',
  add column if not exists search_query text,
  add column if not exists search_location text,
  add column if not exists search_run_id uuid,
  add column if not exists last_scored_at timestamp default now();

create table public.manual_search_runs (
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

create index idx_manual_search_runs_user_started
  on public.manual_search_runs(user_id, started_at desc);

create index idx_job_matches_search_run
  on public.job_matches(search_run_id);
```

---

### Step 9 — Tailored Resumes Table (per-job draft artifacts)

Tailored resumes are generated per job match. They never overwrite the base uploaded resume. A draft becomes usable by apply routes only after the user approves it.

```sql
create table public.tailored_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  match_id uuid references public.job_matches(id) on delete cascade,
  source_resume_id uuid references public.resumes(id) on delete set null,
  status text default 'draft',
    -- 'draft', 'approved', 'rejected', 'superseded', 'failed_validation'
  file_url text,                               -- Supabase Storage URL of generated DOCX/PDF
  file_type text default 'docx',
    -- 'docx', 'pdf'
  version text not null,                       -- e.g. tailored:2026-06-04T10:30:00Z
  tailoring_json jsonb default '{}'::jsonb,    -- AI output shown in the review modal
  validation_json jsonb default '{}'::jsonb,   -- no-fabrication checks, warnings, blocked claims
  created_at timestamp default now(),
  approved_at timestamp
);

create index idx_tailored_resumes_user_match on public.tailored_resumes(user_id, match_id);
create index idx_tailored_resumes_status on public.tailored_resumes(user_id, status);
```

---

### Step 10 — Applications Table (applied jobs tracker)

```sql
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  portal text not null,
  applied_at timestamp default now(),
  status text default 'applied',
    -- 'approved', 'applied', 'viewed', 'interview', 'offer',
    -- 'rejected', 'archived', 'blocked', 'failed', 'needs_review',
    -- 'external_pending'
  apply_mode text default 'manual',
    -- 'manual', 'auto'
  pre_apply_check jsonb default '{}'::jsonb,
  portal_response jsonb default '{}'::jsonb,
  tailored_resume_url text,
  resume_version text,
  blocked_reason text,
  failed_reason text,
  external_apply_url text,
  external_apply_confirmed_at timestamp,
  cover_letter text,
  notes text,
  updated_at timestamp default now()
);

create index idx_applications_user_id on public.applications(user_id);
create index idx_applications_status on public.applications(user_id, status);
create index idx_applications_applied_at on public.applications(applied_at desc);
```

### Step 10b - External Apply Migration

Use `backend/migrations/004_external_apply_pending.sql` when upgrading an existing Supabase project. It adds the apply classification fields without changing historical application rows:

```sql
alter table public.jobs
  add column if not exists apply_method text default 'unknown',
  add column if not exists external_apply_url text,
  add column if not exists portal_metadata jsonb default '{}'::jsonb;

alter table public.applications
  add column if not exists external_apply_url text,
  add column if not exists external_apply_confirmed_at timestamp;
```

`external_pending` means Hunter found a job that requires the user to finish on a company or external ATS site. It must not be counted as a completed application until the user confirms they applied.

---

### Step 11 — Row Level Security (RLS)

Enable RLS so users can only read/write their own data:

```sql
-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.preferences enable row level security;
alter table public.portal_tokens enable row level security;
alter table public.company_accounts enable row level security;
alter table public.job_matches enable row level security;
alter table public.tailored_resumes enable row level security;
alter table public.applications enable row level security;
alter table public.manual_search_runs enable row level security;

-- Profiles: user can only see/edit their own row
create policy "Users can manage own profile"
  on public.profiles for all
  using (auth.uid() = id);

-- Resumes
create policy "Users can manage own resumes"
  on public.resumes for all
  using (auth.uid() = user_id);

-- Preferences
create policy "Users can manage own preferences"
  on public.preferences for all
  using (auth.uid() = user_id);

-- Portal tokens
create policy "Users can manage own portal tokens"
  on public.portal_tokens for all
  using (auth.uid() = user_id);

-- Company accounts
create policy "Users can manage own company accounts"
  on public.company_accounts for all
  using (auth.uid() = user_id);

-- Job matches
create policy "Users can manage own job matches"
  on public.job_matches for all
  using (auth.uid() = user_id);

-- Tailored resumes
create policy "Users can manage own tailored resumes"
  on public.tailored_resumes for all
  using (auth.uid() = user_id);

-- Applications
create policy "Users can manage own applications"
  on public.applications for all
  using (auth.uid() = user_id);

-- Manual search runs
create policy "Users can manage own manual search runs"
  on public.manual_search_runs for all
  using (auth.uid() = user_id);

-- Jobs table is read-only for users (backend writes via service role)
alter table public.jobs enable row level security;
create policy "Jobs are readable by authenticated users"
  on public.jobs for select
  using (auth.role() = 'authenticated');
```

---

### Step 12 — Supabase Storage Bucket

In Supabase dashboard → Storage → New bucket:

```
Bucket name: resumes
Public: No (private)
File size limit: 10MB
Allowed MIME types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

Recommended paths:

```text
{user_id}/original/{timestamp}-{filename}.pdf
{user_id}/tailored/{match_id}/{version}.docx
```

Storage policy — user can only access their own files:
```sql
create policy "Users can upload own resumes"
  on storage.objects for insert
  with check (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can read own resumes"
  on storage.objects for select
  using (bucket_id = 'resumes' and auth.uid()::text = (storage.foldername(name))[1]);
```

---

## Testing

### Manual Verification (Supabase Table Editor)

After running all SQL blocks:

1. Open Supabase → Table Editor — confirm these tables exist:
   - `profiles`, `resumes`, `preferences`, `portal_tokens`, `company_accounts`, `jobs`, `job_matches`, `manual_search_runs`, `tailored_resumes`, `applications`

2. Sign up a test user via Supabase Auth → confirm a `profiles` row is auto-created (the trigger fires)

3. Insert a test row into `jobs` via SQL editor — confirm it saves
4. Try inserting a duplicate `(portal, job_id)` — confirm it fails with unique constraint error

### Python Connection Test

```python
# test_db.py
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv()
client = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_ANON_KEY"))

# Should return empty list, not error
result = client.table("jobs").select("*").limit(1).execute()
print("DB connection OK:", result)
```

---

## Expected Success Behaviour

- All core tables are created with no SQL errors, including `manual_search_runs`
- Jobs can store `apply_method`, `external_apply_url`, and `portal_metadata`, and applications can store `external_pending` plus the user's external confirmation timestamp
- `profiles` row appears automatically when a test user registers — trigger is working
- Inserting a duplicate `(portal, job_id)` into `jobs` raises a unique violation — deduplication will work
- Python test script prints `DB connection OK` without raising an exception
- Storage bucket `resumes` appears in Supabase dashboard

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `trigger already exists` error | Ran the script twice | Drop trigger first: `drop trigger if exists on_auth_user_created on auth.users;` |
| `permission denied` on RLS policy insert | Using anon key for a write | Use service role key for backend writes; anon key for frontend reads |
| Python `APIError: Invalid API key` | Wrong key in `.env` | Double-check `SUPABASE_ANON_KEY` value in Supabase dashboard → Settings → API |
| Storage upload fails with 403 | RLS policy missing or wrong path format | Path must be `user_id/filename.pdf` — folder name must match `auth.uid()` |

## Challenges

- **RLS and service role**: The FastAPI backend should use the `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) for scheduler writes (e.g. inserting jobs fetched for all users). The frontend uses the `SUPABASE_ANON_KEY` with the user's JWT. Mix these up and you'll get silent 0-row inserts.
- **Trigger timing**: The `on_auth_user_created` trigger runs after Supabase Auth creates the user. If you query `profiles` immediately after sign-up in the same request, the row may not exist yet — add a short wait or re-query.
- **jsonb column for parsed_data**: Store the entire Claude-parsed resume JSON here. Querying inside jsonb is possible (`parsed_data->>'name'`) but keep it for display — don't build logic that depends on internal jsonb structure since the Claude output schema can evolve.
