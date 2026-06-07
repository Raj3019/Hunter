-- Manual Job Search metadata.
-- Run after 001_mvp_live_flow_apply_modes.sql and 002_tailored_resume_artifacts.sql.

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

alter table public.manual_search_runs enable row level security;

drop policy if exists "Users can manage own manual search runs" on public.manual_search_runs;
create policy "Users can manage own manual search runs"
  on public.manual_search_runs for all
  using (auth.uid() = user_id);
