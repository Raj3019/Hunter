-- Honest Naukri reconnect signal.
-- Run after 006_naukri_credentials.sql.
--
-- The 1-hour nauk_at token is refreshed silently from the stored credentials, so
-- normal token expiry never needs the user. But when the credentials themselves
-- stop working (password changed, account locked, or Naukri forces a CAPTCHA on
-- login), the silent re-login fails. We record that failure here so the Portals
-- UI can honestly flip to "session expired - sign in again" instead of claiming
-- the connection is still healthy.

alter table public.portal_tokens
  add column if not exists auth_failed_at timestamp;

comment on column public.portal_tokens.auth_failed_at is
  'Set when a silent credential re-login last failed (password changed / locked / CAPTCHA). Cleared on the next successful login. Drives requires_reconnect in portal status.';
