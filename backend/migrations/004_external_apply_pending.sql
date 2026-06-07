-- External apply handling.
-- Run after 001_mvp_live_flow_apply_modes.sql, 002_tailored_resume_artifacts.sql,
-- and 003_manual_job_search.sql.

alter table public.jobs
  add column if not exists apply_method text default 'unknown',
  add column if not exists external_apply_url text,
  add column if not exists portal_metadata jsonb default '{}'::jsonb;

alter table public.applications
  add column if not exists external_apply_url text,
  add column if not exists external_apply_confirmed_at timestamp;

comment on column public.jobs.apply_method is
  'unknown, native, external, or ats_supported. Unknown must not be treated as safely applied.';

comment on column public.jobs.external_apply_url is
  'Best-known external/company-site apply URL, or the source job page when the final external URL is not available yet.';

comment on column public.jobs.portal_metadata is
  'Raw non-secret portal apply flags/debug metadata captured during discovery.';

comment on column public.applications.external_apply_url is
  'External/company-site URL the user must open to complete application.';

comment on column public.applications.external_apply_confirmed_at is
  'Set only when the user confirms they completed an external application.';
