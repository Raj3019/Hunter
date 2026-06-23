-- Hunter complete Supabase schema.
-- Run this once in Supabase SQL Editor for a fresh project.
--
-- This file is intentionally idempotent for repeat runs. The older numbered
-- migration files are kept for historical upgrades; new setups can use this
-- single file.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Profiles and auth trigger
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- User setup
-- ---------------------------------------------------------------------------

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  file_url text,
  parsed_data jsonb default '{}'::jsonb,
  raw_text text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  skills text[] default '{}',
  job_titles text[] default '{}',
  locations text[] default '{}',
  work_type text[] default '{}',
  min_salary integer default 0,
  max_salary integer default 0,
  experience_years integer,
  avoid_companies text[] default '{}',
  apply_mode text default 'manual',
  auto_apply_enabled boolean default false,
  auto_apply_daily_limit integer default 10,
  auto_apply_min_score integer default 75,
  auto_apply_allowed_portals text[] default '{}',
  safe_apply_start_time time default '09:00',
  safe_apply_end_time time default '20:00',
  require_tailored_resume_approval boolean default true,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create unique index if not exists preferences_user_id_key
  on public.preferences(user_id);

-- ---------------------------------------------------------------------------
-- Portal credentials and company accounts
-- ---------------------------------------------------------------------------

create table if not exists public.portal_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  portal text not null,
  bearer_token text,
  profile_id text,
  chrome_profile_path text,
  expires_at timestamptz,
  username text,
  password_encrypted text,
  auth_failed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists portal_tokens_user_portal_key
  on public.portal_tokens(user_id, portal);

create table if not exists public.company_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  company_key text not null,
  company_name text not null,
  login_url text,
  signup_url text,
  username text,
  password_encrypted text,
  account_status text default 'needs_setup',
  chrome_profile_dir text,
  last_login_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists company_accounts_user_company_key
  on public.company_accounts(user_id, company_key);

-- ---------------------------------------------------------------------------
-- Jobs, matches, search runs, tailored artifacts, and applications
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  portal text not null,
  job_id text not null,
  title text,
  company text,
  location text,
  description text,
  salary text,
  experience text,
  tags text[] default '{}',
  apply_link text,
  apply_method text default 'unknown',
  external_apply_url text,
  portal_metadata jsonb default '{}'::jsonb,
  posted_date text,
  is_workday boolean default false,
  is_taleo boolean default false,
  has_questionnaire boolean default false,
  fetched_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  source_status text default 'active'
);

create unique index if not exists jobs_portal_job_id_key
  on public.jobs(portal, job_id);

create table if not exists public.job_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  match_score integer not null default 0,
  match_reasons text[] default '{}',
  matched_skills text[] default '{}',
  missing_skills text[] default '{}',
  score_breakdown jsonb default '{}'::jsonb,
  status text default 'pending',
  tailored_resume_url text,
  tailored_resume_approved boolean default false,
  tailored_resume_version text,
  search_source text default 'scheduler',
  search_query text,
  search_location text,
  search_run_id uuid,
  last_scored_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists job_matches_user_job_id_key
  on public.job_matches(user_id, job_id);

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
  fetched_count integer default 0,
  new_jobs_count integer default 0,
  scored_count integer default 0,
  saved_matches_count integer default 0,
  warnings text[] default '{}',
  error text,
  started_at timestamptz default now(),
  finished_at timestamptz
);

create table if not exists public.tailored_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  match_id uuid references public.job_matches(id) on delete cascade,
  source_resume_id uuid references public.resumes(id) on delete set null,
  status text default 'draft',
  file_url text,
  file_type text default 'docx',
  version text not null,
  tailoring_json jsonb default '{}'::jsonb,
  validation_json jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  approved_at timestamptz
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  portal text not null,
  applied_at timestamptz default now(),
  status text default 'applied',
  apply_mode text default 'manual',
  pre_apply_check jsonb default '{}'::jsonb,
  portal_response jsonb default '{}'::jsonb,
  external_apply_url text,
  external_apply_confirmed_at timestamptz,
  tailored_resume_url text,
  resume_version text,
  match_score integer default 0,
  blocked_reason text,
  failed_reason text,
  cover_letter text,
  notes text,
  updated_at timestamptz default now()
);

-- Indexes used by API filters and dashboard/tracker reads.
create index if not exists idx_resumes_user_id
  on public.resumes(user_id);
create index if not exists idx_portal_tokens_user_portal
  on public.portal_tokens(user_id, portal);
create index if not exists idx_company_accounts_user_company
  on public.company_accounts(user_id, company_key);
create index if not exists idx_jobs_portal
  on public.jobs(portal);
create index if not exists idx_jobs_fetched_at
  on public.jobs(fetched_at desc);
create index if not exists idx_job_matches_user_status
  on public.job_matches(user_id, status);
create index if not exists idx_job_matches_score
  on public.job_matches(match_score desc);
create index if not exists idx_job_matches_search_run
  on public.job_matches(search_run_id);
create index if not exists idx_manual_search_runs_user_started
  on public.manual_search_runs(user_id, started_at desc);
create index if not exists idx_tailored_resumes_user_match
  on public.tailored_resumes(user_id, match_id);
create index if not exists idx_tailored_resumes_status
  on public.tailored_resumes(user_id, status);
create index if not exists idx_applications_user_id
  on public.applications(user_id);
create index if not exists idx_applications_status
  on public.applications(user_id, status);
create index if not exists idx_applications_applied_at
  on public.applications(applied_at desc);

-- ---------------------------------------------------------------------------
-- Updated-at helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_resumes_updated_at on public.resumes;
create trigger set_resumes_updated_at
  before update on public.resumes
  for each row execute function public.set_updated_at();

drop trigger if exists set_preferences_updated_at on public.preferences;
create trigger set_preferences_updated_at
  before update on public.preferences
  for each row execute function public.set_updated_at();

drop trigger if exists set_portal_tokens_updated_at on public.portal_tokens;
create trigger set_portal_tokens_updated_at
  before update on public.portal_tokens
  for each row execute function public.set_updated_at();

drop trigger if exists set_company_accounts_updated_at on public.company_accounts;
create trigger set_company_accounts_updated_at
  before update on public.company_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists set_job_matches_updated_at on public.job_matches;
create trigger set_job_matches_updated_at
  before update on public.job_matches
  for each row execute function public.set_updated_at();

drop trigger if exists set_applications_updated_at on public.applications;
create trigger set_applications_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.resumes enable row level security;
alter table public.preferences enable row level security;
alter table public.portal_tokens enable row level security;
alter table public.company_accounts enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.manual_search_runs enable row level security;
alter table public.tailored_resumes enable row level security;
alter table public.applications enable row level security;

drop policy if exists "Users can manage own profile" on public.profiles;
create policy "Users can manage own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users can manage own resumes" on public.resumes;
create policy "Users can manage own resumes"
  on public.resumes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own preferences" on public.preferences;
create policy "Users can manage own preferences"
  on public.preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own portal tokens" on public.portal_tokens;
create policy "Users can manage own portal tokens"
  on public.portal_tokens for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own company accounts" on public.company_accounts;
create policy "Users can manage own company accounts"
  on public.company_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Jobs are readable by authenticated users" on public.jobs;
create policy "Jobs are readable by authenticated users"
  on public.jobs for select
  using (auth.role() = 'authenticated');

drop policy if exists "Users can manage own job matches" on public.job_matches;
create policy "Users can manage own job matches"
  on public.job_matches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own manual search runs" on public.manual_search_runs;
create policy "Users can manage own manual search runs"
  on public.manual_search_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own tailored resumes" on public.tailored_resumes;
create policy "Users can manage own tailored resumes"
  on public.tailored_resumes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own applications" on public.applications;
create policy "Users can manage own applications"
  on public.applications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Storage bucket for uploaded PDFs and generated tailored DOCX files
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read own resume files" on storage.objects;
create policy "Users can read own resume files"
  on storage.objects for select
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can upload own resume files" on storage.objects;
create policy "Users can upload own resume files"
  on storage.objects for insert
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can update own resume files" on storage.objects;
create policy "Users can update own resume files"
  on storage.objects for update
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "Users can delete own resume files" on storage.objects;
create policy "Users can delete own resume files"
  on storage.objects for delete
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- Documentation comments
-- ---------------------------------------------------------------------------

comment on table public.jobs is
  'Job snapshots fetched from source portals. Source portals remain the source of truth for availability and submission.';
comment on column public.jobs.apply_method is
  'unknown, native, external, or ats_supported. Unknown must not be treated as safely applied.';
comment on column public.jobs.external_apply_url is
  'Best-known external/company-site apply URL, or the source job page when the final external URL is unavailable.';
comment on column public.jobs.portal_metadata is
  'Raw non-secret portal apply flags and debug metadata captured during discovery.';
comment on table public.tailored_resumes is
  'Per-job tailored resume draft artifacts. Drafts must be approved before apply routes may use them.';
comment on column public.tailored_resumes.validation_json is
  'No-fabrication validation result for AI tailoring output.';
comment on column public.portal_tokens.password_encrypted is
  'Fernet-encrypted portal password. Never returned by the API. Decrypted only at the moment of re-login.';
comment on column public.portal_tokens.auth_failed_at is
  'Set when silent credential re-login last failed. Cleared on successful login. Drives requires_reconnect in portal status.';
comment on column public.applications.external_apply_url is
  'External/company-site URL the user must open to complete an application.';
comment on column public.applications.external_apply_confirmed_at is
  'Set only when the user confirms they completed an external application.';
comment on column public.applications.match_score is
  'Resume-match score captured when the application was created, so Tracker can show the Jobs fit signal.';

