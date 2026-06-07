# Naukri Integration — Problems & Solutions

A record of the non-obvious Naukri problems hit during development and how each was solved, with the evidence behind the decision. Reference for the API behaviour: Traverser25/NopeRi.

---

## 1. The saved login died within an hour ("keeps asking to sign in")

**Problem.** After connecting Naukri, the session would stop working very quickly, and the UI either re-prompted for login or (worse) showed "Connected" on a dead login.

**Root cause (verified against live Naukri).** Naukri's `nauk_at` Bearer token is a JWT that expires **1 hour** after issue. A login also sets a 1-year `nauk_rt` refresh cookie + `nauk_sid`, but:
- The app stored **only** the 1-hour `nauk_at` token in `portal_tokens.bearer_token` and never the durable cookies.
- The persistent browser profile couldn't help: revisiting Naukri with an expired `nauk_at` makes Naukri **log the browser out and purge** `nauk_rt`/`nauk_sid` (reproduced — the profile collapses to just `J`/`_t_ds`). There is no transparent refresh-on-navigation.
- Portal status was hardcoded to "connected", so the UI lied about a dead token.

**Solution — encrypted credential re-login.** Store the user's Naukri credentials encrypted (Fernet/AES-256) and silently re-login via the API to mint a fresh `nauk_at` whenever the cached one is expired.
- Migration `006_naukri_credentials.sql` (`username`, `password_encrypted`; `expires_at` caches the JWT exp).
- `portals/naukri/session.py`: `get_valid_naukri_auth()` reuses the cached token while live, else re-logins from stored creds and persists the new token. `naukri_status()` reports real state.
- `POST /api/portals/naukri/credentials` (validates with a live login, encrypts immediately, never returns the password). The credential form is the durable path; the browser-login flow only ever captured the 1-hour token (no password), which is why it wasn't durable.
- Result: sign in once → stays valid across restarts/shutdowns/days → only re-prompts when the credentials genuinely stop working.

---

## 2. No honest "session expired" signal when the login really dies

**Problem.** If the stored credentials stopped working (password changed, account locked, login CAPTCHA), the silent re-login failed in the background but the UI still claimed "connected".

**Root cause.** `naukri_status()` was based only on whether credentials were *stored*, not whether they still *worked*.

**Solution.** Migration `007_naukri_auth_status.sql` adds `auth_failed_at`. `get_valid_naukri_auth` records a failure when a re-login fails and clears it on the next success; `naukri_status` then reports `expired` + `requires_reconnect` ("Naukri sign-in stopped working… sign in again"). Ordinary 1-hour token expiry still refreshes invisibly. Writes are best-effort/migration-safe.

---

## 3. Manual applies weren't reflected — wanted auto-detect, safely

**Problem.** After applying to a job on Naukri, the user had to manually mark it "Applied" in Hunter. Could this be automatic? An early idea was to "grab the apply confirmation URL".

**Why the obvious ideas don't work.**
- The user applies in **their own browser**; Hunter only `window.open`s the job page, so it never sees the confirmation URL.
- Probed for an applied-status read API: guessed endpoints 404'd, the dashboard/search responses carry no applied flag, and a headless browser gets served a degraded page. The only definitive signal from the *apply* endpoint (`applyStatus: {jobId: 200/409001}`) requires *performing* the apply — so it can't be used for passive detection, and automating applies via the internal API is hostile to Naukri (ban risk) and has an unreliable native-vs-redirect decision. We rejected native auto-apply for those reasons.

**Solution — read-only application-history reconcile (found via NopeRi).** Naukri records every application server-side and exposes it read-only at
`GET cloudgateway-apply/whtma-services/v0/applyapi/v5/history` (`appid`/`systemid` 107, referer `myapply/historypage`), returning `applyDetails[]` with `jobId`, status timeline, etc. Verified live it returns the user's applied jobs.
- `NaukriJobClient.get_application_history()`.
- `services/naukri_apply_sync.reconcile_naukri_applications()` matches history `jobId`s against `external_pending` Naukri tasks and advances them to applied/viewed/interview (only ever advances; sets `external_apply_confirmed_at`).
- `POST /api/applications/sync-naukri`; frontend runs it on load + throttled in auto-sync + a manual "Sync applied status" button.
- This is **read-only** (reads the user's own history, like the My Naukri page), so it has none of the ban/abuse risk of automated applying. It also detects **manual** applies — exactly the original ask.

**Coverage — native only.** The history reconcile only covers **native Naukri applies** (`companyApplyJob: False`). Verified: Naukri's history is native-only (every entry is `applyType: normal`; company-site applies never appear). For **company-site / external jobs** (`companyApplyJob: True`), the application happens on the company's own ATS (Workday/Greenhouse/their portal) — entirely outside Naukri, and on a site where Hunter has no login/session/API. There is no signal to read, so it **cannot be auto-confirmed**. Those rely on the **one-tap "I applied / Could not apply"** confirmation on the Open-portal notice. The split:

| Job type | Label in UI | Status update |
|---|---|---|
| Native Naukri (`companyApplyJob` False) | "Applies on Naukri" | Automatic (history sync) |
| Company site (`companyApplyJob` True) | "Applies on company site" | Manual one-tap confirm |

---

## 4. App confused company-site-redirect jobs with native Naukri jobs

**Problem.** Hunter often mislabeled whether a job applies *on Naukri* (native) vs *redirects to the company site* (external), because it was inferring from inconsistent search flags / button text.

**Attempt that failed.** NopeRi classifies via the job-details endpoint `jobapi/v1/job/{id}` → `job.responseManager == "companyUrl"`. But that endpoint requires a **cookie-bearing session**, which our token-only durable login does not carry — it 401s. (And the helper swallowed the error and returned `False`, which would have mislabeled every job as native.) Reverted that wiring.

**Solution — use the `companyApplyJob` flag from search.** Every Naukri search result already includes a boolean `companyApplyJob` (`True` = company-site/external, `False` = native). Verified it's a real discriminator (≈ half/half in a live sample) and present in the *public* search response.
- Wired into `NaukriJobClient._classify_apply_method` at search time — free, no extra request, no cookies — flowing through `apply_method` to the UI, which labels "Applies on company site" vs "Applies on Naukri".
- `get_job_details`/`is_external_apply` are kept as dormant helpers (documented as needing a full browser-profile session).

---

## Cross-cutting note: read-only beats write-back

The durable theme: prefer Naukri's **read-only** signals (history, search flags) over actions that *write* to Naukri (applying via the internal API). Read-only features are low-risk, work with the token-only login, and don't put the user's account in Naukri's crosshairs. See also `docs/context/production-readiness.md` for the single-IP / anti-bot caveats that matter at scale.
