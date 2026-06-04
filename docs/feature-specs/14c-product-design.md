# 14c - Product Design Handoff

This design handoff is based on `14-react-frontend.md` and `14b-frontend-ux-blueprint.md`. It keeps the product behavior, layout rules, theme rules, pages, and safety constraints from those specs as-is.

## Product Intent

Hunter is a job automation cockpit for Indian job seekers. The interface must help the user review AI-scored jobs, approve or skip matches, tailor resumes, manage portal connections, and track applications without feeling like a marketing page.

The product should feel:

- Dense, calm, and operational
- Desktop-first, but responsive enough for smaller screens
- Fast to scan during repeated daily use
- Trustworthy around apply safety, credentials, and AI changes
- Consistent across dark and light themes

## Core Experience

Primary user journey:

1. Sign in or create an account.
2. Upload resume and review parsed data.
3. Save job preferences.
4. Connect portals or acknowledge optional portal setup.
5. Review scored job matches.
6. Tailor resume when needed.
7. Approve a job before any apply action.
8. Queue/apply through SafeApplyManager.
9. Track applications through the pipeline.

No screen should imply that Hunter applies to jobs without user approval.

## Theme Direction

Hunter supports dark and light themes through semantic CSS variables.

Default first-run theme: dark.

Theme persistence:

- Store user selection in `localStorage` as `hunter_theme`.
- Apply selection with `data-theme="dark"` or `data-theme="light"` on the document root.
- Place the theme toggle in the authenticated app shell profile/menu area.
- Also expose the toggle on public auth/home pages.

### Theme Tokens

| Role | Token | Dark | Light |
| --- | --- | --- | --- |
| Page background | `--bg-base` | `#0d0d0d` | `#f7f8fb` |
| Surface | `--bg-surface` | `#161616` | `#ffffff` |
| Elevated surface | `--bg-elevated` | `#1f1f1f` | `#f1f5f9` |
| Primary text | `--text-primary` | `#f0f0f0` | `#111827` |
| Muted text | `--text-muted` | `#6b7280` | `#64748b` |
| Primary accent | `--accent-primary` | `#6366f1` | `#4f46e5` |
| Accent hover | `--accent-hover` | `#4f46e5` | `#4338ca` |
| Success | `--state-success` | `#22c55e` | `#16a34a` |
| Warning | `--state-warning` | `#f59e0b` | `#d97706` |
| Error | `--state-error` | `#ef4444` | `#dc2626` |
| Border | `--border-default` | `#2a2a2a` | `#d8dee9` |
| Score high | `--score-high` | `#22c55e` | `#16a34a` |
| Score medium | `--score-mid` | `#f59e0b` | `#d97706` |
| Score low | `--score-low` | `#ef4444` | `#dc2626` |

Theme rules:

- Components must use semantic variables, not hardcoded theme colors.
- Light mode keeps the same density, layout, hierarchy, and interactions as dark mode.
- Light mode should use cool-neutral surfaces, not beige, cream, or warm paper tones.
- Cards, inputs, chips, modals, drawers, and Kanban columns must remain visually separated in both themes.

## Layout System

Authenticated pages use one shared app shell.

```text
+------------+-------------------------------------------------+
| Hunter     | Search...                 Sync  Queue  Profile  |
| Dashboard  +-------------------------------------------------+
| Jobs       | Page content                                    |
| Tracker    |                                                 |
| Portals    |                                                 |
| Settings   |                                                 |
+------------+-------------------------------------------------+
```

Shell rules:

- Sidebar width: 240px on desktop.
- Sidebar collapses to an icon rail or drawer on smaller screens.
- Top bar contains global search, manual sync/fetch trigger, queue/safety status, profile menu, and theme toggle.
- Authenticated content uses the full width available after the sidebar.
- Cards are used only for repeated jobs, applications, portal/account tiles, modals, and drawers.
- Do not nest cards inside cards.

## Typography And Shape

Typography:

- UI text: Geist Sans, then Inter, then sans-serif.
- Diff/resume comparison: Geist Mono, then monospace.
- Use compact page headings and small table/list labels.
- Do not use oversized hero-scale typography inside dashboards or panels.

Radius:

- Small chips and badges: 4px.
- Buttons: 6px.
- Cards, panels, inputs: 8px.
- Modals and overlays: 12px.

Icons:

- Use Lucide React.
- Use icons for common actions such as refresh, upload, check, warning, external link, trash, close, theme, and settings.
- Icon-only buttons need accessible labels/tooltips.

## Public Home

Purpose: explain the product quickly and route the user to sign in or start setup.

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
| Resume -> Preferences -> Portal connect -> Review -> Apply   |
+--------------------------------------------------------------+
```

Design requirements:

- Keep it compact and product-like, not a large marketing landing page.
- Use product preview cards for job match and application stages.
- Redirect authenticated users to Dashboard.
- Keep the first viewport useful and show a hint of the workflow/app preview below.

States:

- Signed out
- Signed in redirecting
- Auth/session loading

## Auth

Purpose: sign in, register, or reset access.

```text
+--------------------------------------------------------------+
| Hunter                                            Theme       |
|                                                              |
|                 +----------------------------+               |
|                 | Sign in                    |               |
|                 | Email                      |               |
|                 | Password                   |               |
|                 | [ Continue ]               |               |
|                 | Create account / reset     |               |
|                 +----------------------------+               |
+--------------------------------------------------------------+
```

States:

- Login
- Register
- Forgot password
- Invalid credentials
- Loading

Design requirements:

- Center the auth panel.
- Keep copy short.
- Show API/auth errors directly under the relevant action area.
- Do not add decorative illustration panels.

## Onboarding

Purpose: collect resume, preferences, portal connection summary, and final review.

```text
+----------------------+---------------------------------------+
| Hunter               | Resume & Preferences                  |
| 1 Resume             | +-----------------------------------+ |
| 2 Preferences        | | Upload resume / parsed preview    | |
| 3 Portals            | +-----------------------------------+ |
| 4 Review             |                                       |
|                      | Job titles   Locations   Work type    |
|                      | Experience   Salary      Avoid list   |
|                      |                                       |
|                      | Portal connections                    |
|                      | [Naukri] [Foundit] [LinkedIn] [...]  |
|                      |                         [Save setup] |
+----------------------+---------------------------------------+
```

Required sections:

- Resume upload
- Parsed resume preview
- Job preference form
- Portal connection summary
- Final review before entering Dashboard

States:

- No resume uploaded
- Resume parsing
- Parse success
- Parse failed
- Preferences incomplete
- Portal connection optional warning

Design requirements:

- Use a stepped left rail.
- The main panel should prioritize the current step while keeping later steps visible.
- Parsed resume preview must feel reviewable, not like raw JSON.
- Portal connections can be optional, but missing setup should be visible.

## Dashboard

Purpose: show today's automation status and next actions.

```text
+------------+-------------------------------------------------+
| Sidebar    | Today                                           |
|            | +---------+ +---------+ +---------+ +---------+ |
|            | | Matches | | Approved| | Applied | | Blocked | |
|            | +---------+ +---------+ +---------+ +---------+ |
|            |                                                 |
|            | Recommended jobs              Activity          |
|            | +---------------------------+ +---------------+ |
|            | | Job card score/company    | | Applied       | |
|            | | skills/pay/location       | | Tailored      | |
|            | | [Tailor] [Approve] [Skip] | | Portal warn   | |
|            | +---------------------------+ +---------------+ |
+------------+-------------------------------------------------+
```

Content:

- Metric strip: matches found, approved, applied, blocked
- Recommended jobs list
- Apply safety status
- Recent activity feed
- Portal health summary

States:

- First run pending
- No jobs yet
- Jobs found but not scored
- Jobs ready for review
- Safe apply blocked
- Scheduler/API error

Design requirements:

- Dashboard is an overview, not the only job review surface.
- Job cards should be compact and scannable.
- Show safety and portal health close to job actions.
- Activity feed should surface applied, tailored, portal warning, and blocked events.

## Jobs

Purpose: review scored jobs and decide whether to skip, tailor, approve, or apply.

```text
+------------+-------------------------------------------------+
| Sidebar    | Jobs                                            |
|            | Filters: portal role location score status      |
|            |                                                 |
|            | +---------------------------+ +---------------+ |
|            | | Match list                | | Selected job  | |
|            | | score tags company       | | JD summary    | |
|            | | approve/skip/tailor      | | missing skills| |
|            | +---------------------------+ | apply safety  | |
|            |                               +---------------+ |
+------------+-------------------------------------------------+
```

Content:

- Filter bar for portal, role, location, minimum score, status
- Dense job match list
- Selected job detail panel
- Score breakdown
- Matched and missing skills
- Actions: Skip, Tailor, Approve, Apply

Rules:

- No real apply without explicit user approval.
- Apply action must show SafeApplyManager status before queueing.
- Tailor action opens the resume tailor modal.

Design requirements:

- Score badge must be visually prominent but not oversized.
- Matched skills use success styling; missing skills use muted styling.
- Apply action appears only after approval or makes approval state explicit.
- Filters should update the visible list without reloading the whole page.

## Job Card

Information hierarchy:

1. Score badge and role title
2. Company, portal, location, salary/experience if available
3. Matched and missing skills
4. AI reasons or short recommendation note
5. Actions

Actions:

- Approve: primary accent
- Apply Now: success action after approval
- Tailor Resume: outline/secondary
- Skip: muted or destructive-muted

States:

- Pending review
- Approved
- Apply started
- Applied
- Skipped
- Apply blocked
- API error

## Resume Tailor Modal

Purpose: generate and review a job-specific tailored resume draft artifact before approval.

```text
+--------------------------------------------------------------+
| Tailor resume: Role @ Company                         [x]    |
| Draft version: tailored:timestamp   Status: draft             |
| +--------------------------+ +-----------------------------+ |
| | Current resume sections  | | Tailored draft              | |
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
- Show generated artifact version, status, and validation result.
- Let the user approve before the tailored resume artifact is used.
- Approval must target a real generated draft id; empty artifact approvals are invalid.
- The original/base resume remains unchanged.
- Handle AI provider errors clearly.

Design requirements:

- Use full-screen overlay on smaller viewports and centered large modal on desktop.
- Use two side-by-side panels on desktop and stacked panels on mobile.
- Use monospace for diff sections.
- Highlight changed lines clearly but quietly.

## Tracker

Purpose: track applications through the pipeline.

```text
+------------+-------------------------------------------------+
| Sidebar    | Application Tracker                             |
|            | Filters: portal status date company             |
|            |                                                 |
|            | Fetched     Approved     Applied      Interview |
|            | +--------+  +--------+   +--------+   +-------+ |
|            | | card   |  | card   |   | card   |   | card  | |
|            | | card   |  | card   |   | card   |   |       | |
|            | +--------+  +--------+   +--------+   +-------+ |
+------------+-------------------------------------------------+
```

Columns:

- Fetched
- Approved
- Applied
- Interview
- Rejected
- Archived

Card content:

- Job title
- Company
- Portal badge
- Applied date or latest event date
- Score
- Warning marker for failed/blocked applies

Interactions:

- Click card opens detail drawer.
- Status can be updated from the drawer.
- Filters should not reload the whole page unnecessarily.
- Kanban scrolls horizontally on overflow.

## Application Detail Drawer

Purpose: inspect one application without leaving Tracker.

```text
+--------------------------------------+-----------------------+
| Tracker / Jobs                       | Application details   |
|                                      | Company, role, portal |
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

Design requirements:

- Drawer enters from the right on desktop.
- On mobile, drawer becomes a full-screen panel.
- Status update controls must be clear and reversible through another manual update.

## Portal Connections

Purpose: manage job board and browser-session connections.

```text
+------------+-------------------------------------------------+
| Sidebar    | Portal Connections                              |
|            | +-----------+ +-----------+ +-----------+       |
|            | | Naukri OK | | Foundit  | | LinkedIn |       |
|            | | token     | | token    | | browser  |       |
|            | | [Update]  | | [Update] | | [Connect]|       |
|            | +-----------+ +-----------+ +-----------+       |
|            |                                                 |
|            | Company portals                                 |
|            | TCS   Infosys   Cognizant   Wipro   HCL         |
+------------+-------------------------------------------------+
```

Content:

- Naukri token/login status
- Foundit token/login status
- Internshala browser session status
- LinkedIn browser session status
- Company account connection tiles
- Last checked time
- Connect/update/remove actions

Rules:

- Do not show stored passwords or encrypted password fields.
- Do not show saved bearer tokens.
- Browser login flows should clearly say when a one-time manual login is needed.
- Destructive remove/disconnect actions need confirmation.

## Settings

Purpose: configure preferences, AI provider, safe apply, resume management, and account controls.

```text
+------------+-------------------------------------------------+
| Sidebar    | Settings                                        |
|            | Preferences                                    |
|            | Job titles, locations, work type, salary       |
|            |                                                 |
|            | Safe Apply                                     |
|            | Hours, daily limits, cooldowns                 |
|            |                                                 |
|            | AI Provider                                    |
|            | Claude / OpenRouter model                      |
|            |                                                 |
|            | Account                                        |
+------------+-------------------------------------------------+
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
- Keep settings sections un-nested and scannable.

## Shared States

Use explicit state surfaces instead of blank screens.

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

State surface pattern:

```text
+--------------------------------------------------------------+
| Icon / status                                                |
| Short title                                                  |
| One-sentence context                                         |
| [Primary action] [Secondary action]                          |
+--------------------------------------------------------------+
```

## Responsive Behavior

Desktop:

- Fixed 240px sidebar.
- Top bar remains visible.
- Dashboard can use metric strip plus two-column content.
- Jobs can use list plus selected detail panel.
- Tracker uses horizontal Kanban columns.

Tablet/mobile:

- Sidebar collapses to icon rail or drawer.
- Two-column views stack vertically.
- Job detail panel becomes inline below selected card or a drawer.
- Tracker scrolls horizontally.
- Primary actions stay near the relevant content.

## Safety And Trust

Security-sensitive design rules:

- Never render passwords, encrypted passwords, or bearer tokens.
- Show connected/expired/manual-only states without exposing secrets.
- Real apply actions must be visibly gated by approval and SafeApplyManager.
- Tailored resume changes must be reviewed before use.
- AI provider errors should be explicit and recoverable.

## Acceptance Checklist

- Authenticated pages share the app shell.
- Home, Auth, Onboarding, Dashboard, Jobs, Tracker, Portal Connections, Settings, Tailor Modal, and Application Detail Drawer are represented.
- Dark and light themes use one semantic token system.
- Theme toggle persists across reloads.
- Main pages include loading, empty, and error states.
- Portal pages never display password/token secrets.
- Apply remains impossible without user approval and SafeApplyManager.
- Desktop and mobile layouts do not overlap or overflow.
- `npm run build` passes after implementation.
