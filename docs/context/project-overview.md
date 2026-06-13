# Project Overview

## Overview

Hunter is a curated job wrapper for Indian job seekers. It takes a user's profile preferences and resume, fetches jobs based on preferences (skills, titles, locations, work type, salary, experience, and avoid-list), stores useful job snapshots for review and tracking, scores each job against the resume using AI, lets the user review matches, generates user-approved tailored resume drafts per job, opens the original source portal, and tracks the user-confirmed outcome.

Hunter does not replace the job portal. The original job remains on the source portal, while Hunter stores a snapshot of the job details so the user can review, dedupe, score, and track applications reliably.

## Goals

1. Reduce the time a job seeker spends manually searching and applying across multiple portals.
2. Surface high-quality matches (AI score >= 60/100) so the user reviews a curated shortlist, not hundreds of raw results.
3. Keep the MVP safe and portal-compliant by opening original job pages and requiring user confirmation before marking anything applied.

## Core User Flow

1. User uploads their PDF resume; the app parses and displays the extracted data used for match scoring and tailoring.
2. User sets job preferences (skills, titles, locations, work type, salary range, companies to avoid) used for job fetching.
3. Naukri runs as public search in the MVP; an optional credential sign-in (encrypted email/password, server-side re-login) powers personalized recommendations + applied-status, but is never required for search.
4. User can optionally connect portals and company accounts when those flows are needed.
5. User can run Manual Job Search from the Jobs/top-bar search field to fetch from saved preferences, optionally override the role query, score with the resume, and save live matches immediately.
6. Daily at 8am IST the scheduler also fetches jobs from saved preferences, stores job snapshots, scores them against the resume with AI, and saves matches above 60.
7. User opens Dashboard or Jobs, sees scored matches, and reviews each job snapshot with score, matched skills, missing skills, location, experience, salary, and source portal.
8. User clicks Tailor Resume to generate a job-specific tailored resume draft from the current uploaded resume and the selected job description.
9. Hunter shows the draft, suggested changes, matched/missing skills, warnings, and the generated resume artifact version without overwriting the original resume.
10. User approves the tailored resume artifact, opens the original portal page, skips the job, or reviews an existing portal-pending task.
11. Hunter creates a `portal pending` tracker task with the source URL and resume version, then the user completes the application on the portal.
12. User confirms **I applied** or **Could not apply** in Tracker; Hunter records the final status and confirmation time.
13. Future auto-submit remains dormant until a portal flow is explicitly verified as stable and allowed.

## Features

### Job Discovery

- Daily automated fetch across Naukri, Foundit, Internshala, LinkedIn, Workday company sites, Taleo sites, TCS iBegin, Infosys Careers, Cognizant, Wipro, and more.
- Manual on-demand preference-based search from the app shell/Jobs search field, starting with public Naukri search via `/jobapi/v3/search`.
- Job snapshot storage for review, scoring, dedupe, and tracker history while the source portal remains the source of truth.
- Resume-based AI job scoring (0-100) with matched skills, missing skills, and apply recommendation.
- Recommended jobs from Naukri's internal recommendation API are optional future enrichment; normal public search must continue if recommendations fail.

### Resume & Application

- PDF resume upload and AI-powered structured parsing.
- AI resume tailoring per job description that creates a draft artifact/version, shows reviewable changes, and never invents new experience.
- AI questionnaire answerer for application form questions.
- User-reviewed portal-open flow through the original source job page.
- Dormant verified-auto-submit code path for future official/native flows only.

### Tracking & Notifications

- Application tracker dashboard with stage rows and status updates.
- WhatsApp notifications via Twilio (token expiry, interview alerts, daily match summary).
- Email notifications via Resend (application confirmations, daily digest).

### Portal Management

- Naukri public search for the MVP, with optional encrypted-credential sign-in for saved-session features (recommendations + applied-status).
- Bearer token storage for API-based portals where needed, such as Foundit.
- Persistent Chrome profiles for Playwright-based portals (LinkedIn, Internshala, Workday, Taleo).
- Encrypted credential storage for company portals that require a registered account.

## Scope

### In Scope

- Web app (desktop-first) with React frontend and FastAPI backend.
- Portals: Naukri public search, Foundit, Internshala, LinkedIn Easy Apply, Workday (generic handler), Taleo (generic handler), TCS iBegin, Infosys, Cognizant, Wipro, HCL.
- AI scoring, tailoring, and questionnaire answering using Claude API.
- Manual job search, daily scheduled job fetch, job snapshot storage, portal-open tracking, and user-confirmed application outcomes.
- Application tracker with manual status override.
- WhatsApp and email notifications.
- Encrypted credential storage for company portals.
- Deployment on AWS EC2 t2.micro with Elastic IP.

### Out of Scope

- Requiring Naukri login for normal MVP search.
- Mobile app (PWA/push notifications can be added later).
- Proxy rotation.
- Creating fake accounts on any portal.
- Portals outside India (international LinkedIn, Indeed US, etc.).
- Resume building from scratch (only tailoring/versioning of an existing uploaded resume).

## Success Criteria

1. A user can save profile preferences, upload a resume, click Find from profile, and receive Naukri resume-scored job matches without logging into Naukri.
2. A user can open a curated Naukri job on the original portal and Hunter creates a portal-pending Tracker task.
3. User confirmation from portal pending to applied updates Tracker and records `external_apply_confirmed_at`.
4. Broad unattended auto-apply is not exposed in MVP; future auto-submit requires explicitly verified official/native flows.
5. Tailored resume drafts are generated as job-specific artifacts, shown to the user before use, and no fabricated experience appears in the output.
6. Application status updates appear in the Tracker within seconds of the user confirming the portal outcome.

## Future Enhancements (Backlog)

Captured 2026-06-11 after reviewing the open-source `adrianhajdin/job_pilot` ("JobPilot") project. These are **additive to the assist-only flow** — none change the no-auto-apply / per-portal-tracking design. To implement later.

- **Company research dossier + interview prep** (highest value): for a selected match, research the company from public web pages and build a structured dossier — company overview, tech stack, culture, "why the role exists", and interview prep. Hunter currently stores only the job snapshot; this adds context the user reviews before opening the portal. No ToS risk (public pages). This is the one feature where a small, bounded LLM research routine is worth it (see "agent" note below).
- **Per-job cover-letter generation**: extend the existing AI tailoring layer (`ai/resume_tailor.py`, `ai/qa_answerer.py`) to also produce a tailored cover letter per job, shown as a reviewable draft (never auto-sent), mirroring the tailored-resume artifact lifecycle.
- **Generate a clean PDF résumé from profile data**: an additive export option alongside the DOCX tailored drafts (`architecture.md` already flags PDF as a future additive export layer).
- **Recent-activity dashboard feed**: a clearer activity feed on the Dashboard (searches run, matches saved, applies confirmed), optionally with lightweight analytics.

### Note: do we need to be an "AI agent" like JobPilot?

**No — and this is a deliberate design choice, recorded here.** JobPilot brands itself an "autonomous AI agent," but (verified from its code) its implemented flow is a mostly deterministic pipeline (Adzuna search → GPT-4o score → company research → resume/cover-letter tailoring) plus an **experimental, unfinished** Browserbase/Stagehand auto-apply path. Hunter does not need an agent rearchitecture because:

- Hunter's pipeline (search → score → tailor → open portal → reconcile applied-status) is deterministic and already built as discrete services; autonomous LLM-driven looping would add risk and unpredictability and conflicts with the assist-only invariant (no unattended actions).
- Hunter's hard, differentiating capability — **per-portal applied-status detection** — is an integration / reverse-engineering problem, not an agentic one. An "agent" wouldn't help there. (Notably, JobPilot has **no applied-status tracking at all** — its `jobs` table has no status column.)
- The only place an LLM-driven multi-step pattern genuinely helps is the **company research dossier** above, which can be a contained sub-task — not an app-wide change.
