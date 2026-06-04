# 14b - Frontend UX Blueprint

This spec complements `14-react-frontend.md`.

- `14-react-frontend.md` defines the functional React implementation: app setup, routes, API client, auth handling, and backend wiring.
- `14b-frontend-ux-blueprint.md` defines the UX, layout, visual hierarchy, page states, and ASCII wireframes.
- If a layout/design detail conflicts, follow this 14b spec. If an API/client detail conflicts, follow `14-react-frontend.md`.

## Design Direction

Build the final **Air Workbench** interface: a clean, light-only professional SaaS app with a horizontal top navigation, generous whitespace, and focused work areas. The app should feel like a calm job-automation operations suite, not a marketing page and not a crowded admin dashboard.

The key product loop is:

```text
review what needs attention -> inspect one item -> tailor / approve / skip -> track outcome
```

Do not show every system area at once. Dashboard should answer "what needs my attention today"; Jobs should be the detailed split workbench; Tracker should use stage tabs plus an application list/detail panel instead of a crowded Kanban wall; Portals/Settings should use rows and forms instead of tile clutter.

Avoid oversized hero blocks, decorative gradients, stock images, dark-mode-only styling, purple-dominant palettes, sidebars, icon rails, nested cards, and dense board walls.

Reference patterns:

- Linear-style modular dashboards for focused status surfaces and drill-down workspaces: https://linear.app/docs/dashboards
- Ashby core dashboards for recruiting metrics and high-level activity surfaces: https://docs.ashbyhq.com/core-dashboards
- Ashby candidate pipeline for stage-based status behavior: https://docs.ashbyhq.com/candidate-pipeline
- shadcn/Tailwind dashboard templates for restrained tabs, filters, tables, and detail panels.

## Global Layout Rules

- Use React 18, Tailwind CSS, React Router, axios, and lucide icons.
- The Air Workbench redesign is light-only unless a future dark design is explicitly approved. Keep semantic CSS custom properties, but the production visual target is one polished light UI.
- Use the app shell for all authenticated pages: horizontal top navigation, command/status controls, and full-width content area.
- Do not use a desktop sidebar or icon rail in the final Air Workbench design.
- Top navigation items: Dashboard, Jobs, Tracker, Portals, Settings.
- Command controls: Search jobs, Sync, Queue, notifications, profile.
- Use cards only for genuinely standalone objects, modals, and detail panels. Prefer grouped rows with separators for lists.
- Do not nest cards inside other cards.
- Use compact but breathable typography inside dashboards, lists, tables, panels, and forms.
- Use color sparingly:
  - Green: strong match, connected, successful apply
  - Amber: warning, needs review, missing setup
  - Red: blocked, failed, unsafe apply
  - Blue/neutral accent: active navigation and primary actions
- Do not expose or render encrypted secrets, raw passwords, or portal tokens.
- Mobile behavior:
  - Top navigation collapses to a menu or segmented tab row.
  - Two-column workspaces stack vertically.
  - Tracker stage tabs remain horizontal and scrollable if needed.
  - Primary actions remain visible near the relevant content.

## Theme System

Theme selection:

- The final Air Workbench target is light-only.
- If existing theme infrastructure remains in code during transition, default to light and do not expose a dark-mode toggle in the final UI until a matching dark visual system is designed.
- Continue using CSS custom properties so implementation can evolve safely.

Air Workbench light tokens:

- Page background: cool off-white, `--bg-base: #f7f8fb`
- Surface: white, `--bg-surface: #ffffff`
- Elevated surface: pale slate, `--bg-elevated: #f1f5f9`
- Primary text: graphite, `--text-primary: #111827`
- Muted text: slate, `--text-muted: #64748b`
- Primary accent: restrained blue, `--accent-primary: #2563eb`
- Accent hover: deeper blue, `--accent-hover: #1d4ed8`
- Success: `#16a34a`
- Warning: `#d97706`
- Error: `#dc2626`
- Border: cool gray, `#d8dee9`

Air Workbench visual rules:

- Use whitespace, row grouping, alignment, and typography before adding borders.
- Use thin dividers and subtle surface tints before shadows.
- Avoid heavy shadows, gradient backgrounds, and decorative blobs.
- Keep rounded corners subtle: 8px for panels/inputs, 6px for buttons, 4px for chips.
- Do not use beige, cream, or warm paper tones; keep the product technical and cool-neutral.

## Pages And Wireframes

### 1. Auth

Purpose: let the user sign in, register, or reset access before entering the app.

```text
+--------------------------------------------------------------+
| Hunter                                                       |
|                                                              |
|                 +----------------------------+               |
|                 | Sign in                    |               |
|                 | Email                      |               |
|                 | Password                   |               |
|                 | [ Continue ]               |               |
|                 | Create account / reset     |               |
|                 +----------------------------+               |
|                                                              |
+--------------------------------------------------------------+
```

States:

- Login
- Register
- Forgot password
- Invalid credentials
- Loading

### 2. Home

Purpose: explain the product quickly and route the user to sign in or start setup. This is the only public page before auth, and it should still feel like the same dense app product rather than a marketing landing page.

```text
+--------------------------------------------------------------+
| Hunter                                  Sign in  Get started |
+--------------------------------------------------------------+
| Job automation cockpit for Indian job portals                |
| Search, score, tailor, approve, and track every application. |
|                                                              |
| [Get started] [Sign in]                                      |
|                                                              |
| +----------------+ +----------------+ +--------------------+ |
| | Connected      | | Safe Apply     | | Tracker            | |
| | Naukri, etc.   | | limits + hours | | pipeline + history | |
| +----------------+ +----------------+ +--------------------+ |
|                                                              |
| How it works                                                 |
| Resume -> Preferences -> Portal connect -> Review -> Apply   |
|                                                              |
| +--------------------------+ +-----------------------------+ |
| | Preview: job match card  | | Preview: application stages | |
| | score, skills, actions   | | fetched/approved/applied    | |
| +--------------------------+ +-----------------------------+ |
+--------------------------------------------------------------+
```

Content:

- Product name and one clear description.
- Primary action: Get started.
- Secondary action: Sign in.
- Short capability strip: portal search, AI scoring/tailoring, SafeApplyManager, tracker.
- Small workflow row showing the actual user journey.
- App preview area using compact dashboard/job-card visuals.

Rules:

- Do not build a large hero with decorative graphics.
- Do not make this page the main product experience for signed-in users.
- If the user is already authenticated, redirect from Home to Dashboard.
- Keep the first viewport useful and leave a hint of the workflow/app preview below.

States:

- Signed out
- Signed in redirecting
- Auth/session loading

### 3. Onboarding

Purpose: collect the resume, preferences, and first portal connections.

```text
+----------------------------------------------------------------+
| Hunter   Dashboard  Jobs  Tracker  Portals  Settings          |
+----------------------------------------------------------------+
| Resume & Preferences                                           |
| Resume -> Preferences -> Portals -> Review                     |
|                                                                |
| +------------------------------------------------------------+ |
| | Active setup step                                          | |
| | Upload resume / parsed preview                            | |
| | Job titles, locations, work type, experience, salary       | |
| | Portal connections: Naukri, Foundit, LinkedIn, ...         | |
| |                                           [Save setup]     | |
| +------------------------------------------------------------+ |
+----------------------------------------------------------------+
```

Required sections:

- Resume upload
- Parsed resume preview
- Job preference form
- Portal connection summary
- Final review before entering dashboard

States:

- No resume uploaded
- Resume parsing
- Parse success
- Parse failed
- Preferences incomplete
- Portal connection optional warning

### 4. App Shell

Purpose: shared authenticated layout for all main pages.

```text
+----------------------------------------------------------------+
| Hunter   Dashboard  Jobs  Tracker  Portals  Settings          |
|          Search jobs...                 Sync  Queue  Bell  Me  |
+----------------------------------------------------------------+
| Page content                                                   |
|                                                                |
+----------------------------------------------------------------+
```

Navigation:

- Dashboard
- Jobs
- Tracker
- Portals
- Settings

Top bar:

- Hunter brand at far left
- Horizontal nav tabs with active underline or subtle filled state
- Global search
- Manual sync/fetch trigger
- Apply queue/safety status
- Notifications
- User profile menu

Rules:

- Do not add a desktop sidebar or icon rail.
- Keep the header sticky, white, and separated by one quiet bottom border.
- Use compact icon buttons for sync, queue, notifications, and profile where labels would crowd.
- On mobile, collapse nav links behind a menu button or horizontal tab scroller.

### 5. Dashboard

Purpose: show today's job automation status and next actions.

```text
+----------------------------------------------------------------+
| Today                                      Matches Queue Blocked |
| Review only what needs action.                                  |
| Resume parsed  Preferences saved  Portals connected             |
|                                                                |
| +-------------------------------+ +----------------------------+ |
| | Next best action              | | SafeApplyManager           | |
| | 91 match Frontend Engineer    | | 9am-8pm IST                | |
| | PhonePe / Greenhouse          | | Daily limit / cooldown     | |
| | JD summary, skills, safety    | | Approval required          | |
| | [Tailor] [Approve] [Skip]     | +----------------------------+ |
| +-------------------------------+                              |
|                                                                |
| +-------------------------------+ +----------------------------+ |
| | Pipeline preview              | | Portal health              | |
| | Fetched Approved Applied...   | | Naukri OK / Foundit warn   | |
| +-------------------------------+ +----------------------------+ |
+----------------------------------------------------------------+
```

Content:

- Header: `Today` with the one-sentence purpose, "Review only what needs action."
- Compact metrics: Matches, Queue, Blocked
- Subtle setup strip: Resume parsed, Preferences saved, Portals connected
- Primary focus: Next best action card for the highest-priority job
- Next best action includes score, title, company, portal, JD summary, matched/missing skills, safety state, and Tailor/Approve/Skip actions
- Slim SafeApplyManager rail: safe hours, daily limit, cooldown, approval required
- Lower previews only: Pipeline and Portal health

Rules:

- Dashboard must not become a dense admin overview.
- Prefer one high-confidence action over a list of many jobs.
- Keep secondary panels visually quiet and below the fold if vertical space is tight.
- Use the Jobs page for detailed review queue work.

States:

- First run pending
- No jobs yet
- Jobs found but not scored
- Jobs ready for review
- Safe apply blocked
- Scheduler/API error

### 6. Job Matches

Purpose: review scored jobs and decide whether to skip, tailor, approve, or apply.

```text
+----------------------------------------------------------------+
| Job matches                    7 to review  3 blocked 12 queued |
| Resume parsed  Preferences saved  Portals connected  Review gate|
| Filters: Portal  Status  Score  Saved views                     |
|                                                                |
| +-------------------------------------+ +----------------------+ |
| | Review queue                        | | Selected match       | |
| | 91 Frontend Engineer PhonePe Safe   | | 91 match             | |
| | 86 Backend Engineer Groww Safe      | | JD summary           | |
| | 78 System Engineer Infosys Caution  | | AI fit bars          | |
| | 64 QA Engineer TCS Blocked          | | Matched / missing    | |
| | ...                                 | | Resume version       | |
| +-------------------------------------+ | SafeApplyManager     | |
|                                         | [Tailor][Approve][Skip]|
|                                         +----------------------+ |
+----------------------------------------------------------------+
```

Content:

- Page header: Job matches with 7 to review, 3 blocked, 12 queued
- Subtle setup/status strip: Resume parsed, Preferences saved, Portals connected, Review before apply
- Filter row: Portal, Status, Score, Saved views
- Two-column workbench:
  - Left: Review queue as spacious rows with score circle, role, company, portal, status, safety, compact action/overflow
  - Right: Selected match detail panel
- Score breakdown
- Matched and missing skills
- JD summary
- Resume version
- SafeApplyManager note
- Actions: Tailor, Approve, Skip; Apply only appears after approval or as a queued/safe state when appropriate

Rules:

- No real apply without explicit user approval.
- Apply action must show SafeApplyManager status before queueing.
- Tailor action opens the resume tailor modal.
- Do not add a side navbar.
- Do not render the queue as separate heavy cards.
- Use row separators and a stable selected state.

### 7. Application Tracker

Purpose: track applications through the pipeline.

```text
+----------------------------------------------------------------+
| Application tracker                                             |
| Track outcomes without losing context.                          |
| 56 applied   8 interviews   3 warnings                          |
| Filters: Portal  Status  Date  Company  Search applications     |
|                                                                |
| Fetched | Approved | Applied | Interview | Rejected | Archived  |
|                         active: Applied                         |
|                                                                |
| +-------------------------------------+ +----------------------+ |
| | Applications                        | | Application details  | |
| | Backend Engineer  Postman  88  OK   | | Backend Engineer     | |
| | React Developer   TCS      72  warn | | Timeline             | |
| | UI Engineer       Razorpay 83  OK   | | Resume version       | |
| | Python Developer  HCL      61  warn | | Apply response       | |
| | ...                                 | | Notes / status       | |
| +-------------------------------------+ | [Update] [Close]     | |
|                                         +----------------------+ |
+----------------------------------------------------------------+
```

Stage tabs:

- Fetched
- Approved
- Applied
- Interview
- Rejected
- Archived

Content:

- Header: Application tracker with applied/interview/warning counts
- Filter row: Portal, Status, Date, Company, Search applications
- Slim segmented stage tabs with counts; active stage controls the list
- Left column: Applications list/table for the selected stage
- Application rows show title, company, portal badge, score, latest update, warning icon if needed, and status chip
- Optional quiet alert row: "2 applications need portal review"
- Right column: Application details panel
- Detail panel shows role, company, portal, location, score, timeline, resume version, apply response, notes, status selector, Update, Close
- Warning markers for failed/blocked applies

Interactions:

- Click row selects the application and updates the detail panel.
- Status can be updated from the detail panel.
- Filters should not reload the whole page unnecessarily.
- On mobile, the detail panel can become a drawer after row selection.

Rules:

- Do not use a full Kanban wall for the final tracker.
- Do not show six crowded columns at once.
- Keep the main workspace to two columns.
- Use stage tabs for pipeline navigation and rows for readable application records.

### 8. Application Detail Panel

Purpose: inspect one application without leaving the tracker.

```text
+--------------------------------------+-----------------------+
| Application list                     | Application details   |
| selected row                         | Company, role, portal |
|                                      | Timeline              |
|                                      | Resume version        |
|                                      | Apply response        |
|                                      | Notes/status          |
|                                      | [Update] [Close]      |
+--------------------------------------+-----------------------+
```

Content:

- Role, company, location, portal
- Timeline of fetched, scored, approved, applied
- Resume version/tailoring summary
- Apply response summary
- Notes
- Manual status update

Rules:

- Desktop uses an in-page right detail panel.
- Mobile may use a drawer to preserve space.

### 9. Resume Tailor Modal

Purpose: generate and review a job-specific tailored resume draft artifact before approval.

```text
+--------------------------------------------------------------+
| Tailor resume: Role @ Company                         [x]    |
| Draft version: tailored:timestamp   Status: draft             |
| +--------------------------+ +-----------------------------+ |
| | Current resume sections  | | Tailored suggestion         | |
| | summary/skills/projects  | | changes highlighted        | |
| +--------------------------+ +-----------------------------+ |
| Validation: no invented claims / warnings if any              |
| Missing skills   Matched skills   Generated .docx             |
| [Regenerate] [Download draft] [Approve tailored resume]       |
+--------------------------------------------------------------+
```

Rules:

- Never imply invented experience.
- Show matched and missing skills.
- Show the generated draft version and validation result.
- Let the user approve before the tailored resume artifact is used.
- Approval must target a real generated draft id; empty artifact approvals are invalid.
- The original/base resume must remain unchanged.
- Handle AI provider errors clearly.

### 10. Portal Connections

Purpose: manage job board and browser-session connections.

```text
+----------------------------------------------------------------+
| Portal connections                                              |
| Manage job boards and company accounts without exposing secrets.|
| 4 connected   1 expired   2 manual                              |
| Tabs: Portals  Preferences  Safe Apply  Resume  AI Provider     |
|                                                                |
| +-------------------------------------+ +----------------------+ |
| | Portal status                       | | Company accounts     | |
| | Naukri       Token    Connected     | | Company              | |
| | Foundit      Token    Expired       | | Username             | |
| | LinkedIn     Browser  Ready         | | Password hidden      | |
| | Internshala  Browser  Manual login  | | [Save account]       | |
| | Workday      Browser  Checking      | | Saved account rows   | |
| | Taleo        Browser  Not connected | | TCS / Infosys / HCL  | |
| +-------------------------------------+ +----------------------+ |
| Preferences saved  SafeApply active  Claude configured Resume OK|
+----------------------------------------------------------------+
```

Content:

- Top management tabs: Portals, Preferences, Safe Apply, Resume, AI Provider
- Active tab: Portals
- Header stats: connected, expired, manual
- Portal connection list rows:
  - Naukri token status
  - Foundit token status
  - LinkedIn browser session status
  - Internshala browser session status
  - Workday browser status
  - Taleo browser status
- Last checked time
- Hidden credential note
- Compact connect/update/confirm browser actions
- Company accounts form and saved account list
- Lower settings preview strip: Preferences saved, SafeApplyManager active, Claude Sonnet configured, Resume active

Rules:

- Do not show stored passwords or encrypted password fields.
- Browser login flows should clearly say when a one-time manual login is needed.
- Use rows and forms, not a grid of many portal cards.
- Keep the management screen calm and form-forward.

### 11. Settings

Purpose: configure preferences, AI provider, safe apply, and account settings.

```text
+----------------------------------------------------------------+
| Settings                                                       |
| Tabs: Preferences  Safe Apply  Resume  AI Provider  Account    |
|                                                                |
| +------------------------------------------------------------+ |
| | Active tab content                                         | |
| | Preferences: titles, locations, work type, salary, avoid   | |
| | Safe Apply: hours, daily limit, cooldown, approval gate     | |
| | Resume: active version and upload/update action            | |
| | AI Provider: configured/unconfigured status                | |
| | Account: session and sign-out controls                     | |
| +------------------------------------------------------------+ |
+----------------------------------------------------------------+
```

Sections:

- Job preferences
- Safe apply display/settings
- AI provider/model display
- Resume management
- Account controls

Rules:

- If provider secrets are backend-only, show configured/unconfigured status instead of raw key values.
- Safe apply changes should explain operational impact through concise labels, not long help text.
- Settings can share the same management tab pattern as Portal Connections.
- Do not render all settings sections as a long wall at once; active tabs should reduce vertical clutter.

## Shared Empty, Loading, And Error States

Use explicit state surfaces instead of blank screens.

```text
+--------------------------------------------------------------+
| Icon / status                                                |
| Short title                                                  |
| One-sentence context                                         |
| [Primary action] [Secondary action]                          |
+--------------------------------------------------------------+
```

Required states:

- No resume uploaded
- No preferences saved
- No portals connected
- No matches found
- Scheduler has not run yet
- AI provider missing
- Portal token expired
- Apply blocked by SafeApplyManager
- API request failed
- Loading list
- Loading detail panel

## Implementation Notes

### Air Workbench Implementation Plan

Implement the redesign in this order:

1. **Foundation**
   - Update semantic CSS variables to the Air Workbench light tokens.
   - Replace the authenticated shell with the horizontal top navigation.
   - Remove desktop sidebar/icon-rail behavior from the final app shell.
   - Keep mobile navigation as a compact menu or horizontal tab scroller.

2. **Shared Components**
   - Add or refactor reusable pieces for `TopNav`, `FilterChip`, `StatusChip`, `MetricBadge`, `JobRow`, `ApplicationRow`, `DetailPanel`, `StageTabs`, `PortalRow`, and form rows.
   - Keep modals/drawers only where they serve a focused task, such as resume tailoring or mobile detail views.

3. **Approved Screens**
   - Dashboard: next-best-action summary with SafeApplyManager rail, Pipeline preview, and Portal health preview.
   - Jobs: split Air Workbench view with Review queue rows and Selected match detail panel.
   - Tracker: stage tabs, filtered application rows, and in-page Application details panel.
   - Portals/Settings: management tabs with portal rows, company account form, preferences, safe apply, resume, and AI provider states.

4. **Live Functional Wiring**
   - Replace existing auth demo flow, mock job/application state, and local-only authenticated transitions with real FastAPI calls.
   - Preserve approve/skip/tailor/apply interactions, tracker status update, portal connect/update/disconnect flows, settings edit controls, and search/sync/profile interactions against live data.
   - Keep user approval and pre-apply checks visibly gating every real apply path.
   - Manual Apply now should show immediate checking/submission states; auto-apply should show SafeApplyManager limits, safe window, and daily progress.
   - Never display raw portal tokens, passwords, or encrypted password fields.

5. **QA**
   - Run `npm run build`.
   - Verify desktop and mobile layouts for Dashboard, Jobs, Tracker, and Portals/Settings.
   - Confirm no clipped labels, overlapping UI, dense card walls, desktop sidebar, icon rail, or full Kanban tracker remains.

- Build page structure first, then connect live data.
- Keep route-level page components thin and move reusable UI into components.
- Prefer icons for common actions: refresh, settings, upload, check, warning, external link, trash, close.
- Use accessible labels/tooltips for icon-only buttons.
- Keep text inside buttons short.
- All destructive actions need confirmation.
- All real apply actions must be visibly gated by user approval and pre-apply checks. Auto-apply must also surface SafeApplyManager throttling.

## Test Plan

Run after implementation:

```bash
cd frontend
npm run build
```

Manual browser checks:

- Home page renders signed-out state and redirects authenticated users to Dashboard.
- Auth page renders and handles login/register errors.
- Air Workbench light UI keeps readable contrast across navigation, rows, forms, modals, badges, and detail panels.
- Onboarding handles upload, parsing, preference save, and missing portal warnings.
- Dashboard renders empty, loading, populated, and error states.
- Dashboard keeps the primary focus on one next best action.
- Jobs page supports filter changes, selected job details, approve/skip/tailor/apply actions in the split workbench.
- Tracker shows stage tabs, filtered application rows, and the in-page detail panel.
- Tailor modal shows current vs tailored content and approval controls.
- Portal page never displays password/token secrets.
- Portal/Settings management tabs render portal rows, company account form, preferences, AI provider status, and safe apply status.
- Desktop and mobile layouts do not overlap or overflow.

## Acceptance Criteria

- All pages listed in this spec exist or are explicitly mapped to an existing route.
- Authenticated pages share the same app shell.
- Authenticated app shell uses horizontal top navigation with no desktop sidebar or icon rail.
- Dashboard, Jobs, Tracker, and Portals/Settings match the final Air Workbench visual direction.
- The UI is light-only, airy, professional, and operational rather than marketing-style or admin-cluttered.
- Semantic CSS variables are used for colors and state tokens.
- Every main page has loading, empty, and error states.
- Real apply remains impossible without user approval and SafeApplyManager.
- `npm run build` passes before moving to notifications/deployment.

## Assumptions

- Implement `14-react-frontend.md` first for the functional frontend foundation.
- Apply this 14b spec next to upgrade the same pages into the final UX.
- No backend schema changes are required for this blueprint.
- The first production frontend can remain desktop-first, with responsive stacking/collapsing for mobile.
- Existing dark-mode code may remain temporarily, but the approved implementation target is the Air Workbench light design.
