# Project Overview

## Overview

Hunter is a job automation web app for Indian job seekers. It takes a user's resume and job preferences, searches for matching jobs across major Indian portals (Naukri, Foundit, Internshala, LinkedIn, Workday company sites, Taleo sites, TCS, Infosys, and more), stores useful job snapshots for review and tracking, scores each job against the resume using AI, lets the user review and approve matches, generates user-approved tailored resume drafts per job, and applies through the original source portal. Every application is tracked in a dashboard.

Hunter does not replace the job portal. The original job remains on the source portal, while Hunter stores a snapshot of the job details so the user can review, dedupe, score, and track applications reliably.

## Goals

1. Reduce the time a job seeker spends manually searching and applying across multiple portals to near zero
2. Surface only high-quality matches (AI score ≥ 60/100) so the user reviews a curated shortlist, not hundreds of raw results
3. Support fast user-reviewed Apply now while keeping automated/batch apply safe with human-like delays, per-portal daily limits, and safe apply windows

## Core User Flow

1. User uploads their PDF resume — the app parses and displays the extracted data for confirmation
2. User sets job preferences (titles, locations, work type, salary range, companies to avoid)
3. User connects portals — pastes Bearer token for Naukri/Foundit, does a one-time manual login for LinkedIn/Playwright-based portals, saves encrypted credentials for company portals (TCS, Infosys, etc.)
4. Daily at 8am IST the scheduler fetches jobs from all connected portals, stores job snapshots, scores them with AI, and saves matches above 60
5. User opens Dashboard, sees today's scored matches, and reviews each job snapshot with score, matched skills, missing skills, location, experience, salary, and source portal
6. User clicks Tailor Resume to generate a job-specific tailored resume draft from the current uploaded resume and the selected job description
7. Hunter shows the draft, suggested changes, matched/missing skills, warnings, and the generated resume artifact version without overwriting the original resume
8. User approves the tailored resume artifact, approves the job for apply, skips the job, or uses Apply now to submit immediately after quick checks
9. Manual Apply now runs pre-apply checks and submits through the original portal if blockers are clear, using the approved tailored artifact for that job when available and otherwise the base uploaded resume
10. Optional auto-apply uses SafeApplyManager to apply approved matches slowly within user-configured limits and safe windows
11. Tracker shows all applications in stage rows (Fetched, Approved, Applied, Interview, Rejected, Archived); user can update status manually and see which resume version was used

## Features

### Job Discovery
- Daily automated fetch across Naukri, Foundit, Internshala, LinkedIn, Workday company sites, Taleo sites, TCS iBegin, Infosys Careers, Cognizant, Wipro, and more
- Job snapshot storage for review, scoring, dedupe, and tracker history while the source portal remains the source of truth
- AI job scoring (0–100) with matched skills, missing skills, and apply recommendation
- Recommended jobs from Naukri's internal recommendation API

### Resume & Application
- PDF resume upload and AI-powered structured parsing
- AI resume tailoring per job description that creates a draft artifact/version, shows reviewable changes, and never invents new experience
- AI questionnaire answerer for application form questions
- User-reviewed Apply now through the original portal
- Optional per-portal auto-apply with tailored resume upload where supported

### Tracking & Notifications
- Application tracker dashboard with stage rows and status updates
- WhatsApp notifications via Twilio (token expiry, interview alerts, daily match summary)
- Email notifications via Resend (application confirmations, daily digest)

### Portal Management
- Bearer token storage for API-based portals (Naukri, Foundit)
- Persistent Chrome profiles for Playwright-based portals (LinkedIn, Internshala, Workday, Taleo)
- Encrypted credential storage for company portals that require a registered account

## Scope

### In Scope

- Web app (desktop-first) with React frontend and FastAPI backend
- Portals: Naukri, Foundit, Internshala, LinkedIn Easy Apply, Workday (generic handler), Taleo (generic handler), TCS iBegin, Infosys, Cognizant, Wipro, HCL
- AI scoring, tailoring, and questionnaire answering using Claude API
- Daily scheduled job fetch, job snapshot storage, manual reviewed apply, and optional auto-apply
- Application tracker with manual status override
- WhatsApp + email notifications
- Encrypted credential storage for company portals
- Deployment on AWS EC2 t2.micro with Elastic IP

### Out of Scope

- Mobile app (PWA/push notifications can be added in Month 3)
- Proxy rotation (breaks Naukri session binding to Elastic IP)
- Creating fake accounts on any portal
- Portals outside India (international LinkedIn, Indeed US, etc.)
- Resume building from scratch (only tailoring/versioning of an existing uploaded resume)

## Success Criteria

1. A user can upload a resume, connect Naukri, and receive scored job matches within 24 hours
2. User-reviewed Apply now to a Naukri job completes end-to-end through the original portal after quick checks
3. Auto-apply can apply to approved jobs within configured daily limits and safe windows without looking like mass automation
4. LinkedIn Easy Apply walks through all form steps and submits without CAPTCHA or block during normal conservative usage
5. Tailored resume drafts are generated as job-specific artifacts, shown to the user before use, and no fabricated experience appears in the output
6. Application status updates appear in the Tracker within seconds of an apply completing or being blocked
