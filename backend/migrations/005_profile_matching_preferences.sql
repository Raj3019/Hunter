-- Profile-first matching preferences.
-- Run after 001_mvp_live_flow_apply_modes.sql.

alter table public.preferences
  add column if not exists skills text[] default '{}';

comment on column public.preferences.skills is
  'User-declared skills used to focus job discovery. Resume parsing remains the source for AI match scoring.';
