-- Persist the resume-match score (0-100) on the application row so the Tracker
-- can display it. The score is computed at search/scoring time and lives on
-- job_matches, but manual search is ephemeral (not stored there), so the score
-- must travel with the application when the portal is opened.
-- Run after 004_external_apply_pending.sql.

alter table public.applications
  add column if not exists match_score integer default 0;

comment on column public.applications.match_score is
  'Resume-match score (0-100) captured when the application was created, so the Tracker can show the same fit signal as the Jobs list.';
