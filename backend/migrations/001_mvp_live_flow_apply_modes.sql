-- MVP live flow + apply modes schema updates.
-- Run this in Supabase SQL Editor after the original schema is installed.

alter table public.profiles
  add column if not exists is_admin boolean default false;

alter table public.preferences
  add column if not exists apply_mode text default 'manual',
  add column if not exists auto_apply_enabled boolean default false,
  add column if not exists auto_apply_daily_limit integer default 10,
  add column if not exists auto_apply_min_score integer default 75,
  add column if not exists auto_apply_allowed_portals text[] default '{}',
  add column if not exists safe_apply_start_time time default '09:00',
  add column if not exists safe_apply_end_time time default '20:00',
  add column if not exists require_tailored_resume_approval boolean default true;

alter table public.jobs
  add column if not exists last_seen_at timestamp default now(),
  add column if not exists source_status text default 'active';

alter table public.job_matches
  add column if not exists tailored_resume_url text,
  add column if not exists tailored_resume_approved boolean default false,
  add column if not exists tailored_resume_version text;

alter table public.applications
  add column if not exists apply_mode text default 'manual',
  add column if not exists pre_apply_check jsonb default '{}'::jsonb,
  add column if not exists portal_response jsonb default '{}'::jsonb,
  add column if not exists tailored_resume_url text,
  add column if not exists resume_version text,
  add column if not exists blocked_reason text,
  add column if not exists failed_reason text;

comment on table public.jobs is
  'Job snapshots fetched from source portals. Source portal remains the source of truth for availability and apply.';

comment on column public.applications.apply_mode is
  'manual for user-reviewed Apply now, auto for SafeApplyManager-throttled auto-apply.';
