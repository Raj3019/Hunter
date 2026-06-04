-- Tailored resume draft artifacts.
-- Run this in Supabase SQL Editor after 001_mvp_live_flow_apply_modes.sql.

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
  created_at timestamp default now(),
  approved_at timestamp
);

create index if not exists idx_tailored_resumes_user_match
  on public.tailored_resumes(user_id, match_id);

create index if not exists idx_tailored_resumes_status
  on public.tailored_resumes(user_id, status);

alter table public.tailored_resumes enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tailored_resumes'
      and policyname = 'Users can manage own tailored resumes'
  ) then
    create policy "Users can manage own tailored resumes"
      on public.tailored_resumes for all
      using (auth.uid() = user_id);
  end if;
end $$;

alter table public.job_matches
  add column if not exists tailored_resume_url text,
  add column if not exists tailored_resume_approved boolean default false,
  add column if not exists tailored_resume_version text;

alter table public.applications
  add column if not exists tailored_resume_url text,
  add column if not exists resume_version text;

comment on table public.tailored_resumes is
  'Per-job tailored resume draft artifacts. Drafts must be approved before apply routes may use them.';

comment on column public.tailored_resumes.validation_json is
  'No-fabrication validation result for AI tailoring output.';
