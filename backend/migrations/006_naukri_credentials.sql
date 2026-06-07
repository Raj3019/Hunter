-- Naukri durable login via encrypted credentials.
-- Run after 005_profile_matching_preferences.sql.
--
-- Why: Naukri's bearer token (nauk_at) is a JWT that expires after ~1 hour, and
-- Naukri logs a browser profile out once that token lapses, purging the long
-- nauk_rt refresh cookie. Storing only the 1h token therefore makes the
-- connection die within an hour. To keep the connection valid until Naukri
-- naturally rejects the login, we store the user's Naukri credentials encrypted
-- (Fernet/AES-256) and silently re-login to mint a fresh token when the cached
-- one is expired.

alter table public.portal_tokens
  add column if not exists username text,
  add column if not exists password_encrypted text;

comment on column public.portal_tokens.username is
  'Portal account username/email. Used to silently re-login when the cached token expires.';

comment on column public.portal_tokens.password_encrypted is
  'Fernet-encrypted portal password. Never returned by any API. Decrypted only at the moment of re-login.';

comment on column public.portal_tokens.expires_at is
  'Cached bearer-token expiry (from the token JWT exp claim). Used to decide when a silent re-login is needed.';
