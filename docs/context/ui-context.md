# UI Context

## Theme

The approved frontend direction is **Air Workbench**: a light-only, clean, professional SaaS workspace with horizontal top navigation, generous whitespace, thin dividers, and focused two-column work areas.

The UI should feel modern and premium without becoming a decorative marketing site or a crowded admin dashboard. Existing dark-mode code may remain temporarily during migration, but the final visual target is one polished light UI. Do not expose a dark-mode toggle unless a matching dark Air Workbench design is approved later.

## Colors

All components must use these CSS custom property tokens. Avoid hardcoded hex values in components.

| Role | CSS Variable | Air Workbench value |
| --- | --- | --- |
| Page background | `--bg-base` | `#f7f8fb` |
| Surface (panels, rows) | `--bg-surface` | `#ffffff` |
| Elevated surface (modals/details) | `--bg-elevated` | `#f1f5f9` |
| Primary text | `--text-primary` | `#111827` |
| Muted text | `--text-muted` | `#64748b` |
| Primary accent (CTA buttons) | `--accent-primary` | `#2563eb` |
| Accent hover | `--accent-hover` | `#1d4ed8` |
| Success / Approved | `--state-success` | `#16a34a` |
| Warning / Pending | `--state-warning` | `#d97706` |
| Error / Rejected | `--state-error` | `#dc2626` |
| Border | `--border-default` | `#d8dee9` |
| Strong border | `--border-strong` | `#94a3b8` |
| Score high (>= 80) | `--score-high` | `#16a34a` |
| Score medium (60-79) | `--score-mid` | `#d97706` |
| Score low (< 60) | `--score-low` | `#dc2626` |

## Typography

| Role | Font | CSS Variable |
| --- | --- | --- |
| UI text | Geist Sans | `--font-sans` |
| Code / mono (resume diff) | Geist Mono | `--font-mono` |

## Border Radius

| Context | Class |
| --- | --- |
| Inline / small UI (badges, chips) | `rounded` (4px) |
| Cards / panels / inputs | `rounded-lg` (8px) |
| Modals / overlays | `rounded-xl` (12px) |
| Buttons | `rounded-md` (6px) |

## Component Library

Tailwind CSS utility classes. No component library; build components from scratch with Tailwind. Shared components should be small and focused: top navigation shell, status chips, filter chips, job rows, application rows, detail panels, form rows, and modals.

## Layout Patterns

- **App shell**: Horizontal top nav only. No desktop sidebar and no icon rail. Header contains Hunter brand, Dashboard, Jobs, Tracker, Portals, Settings, Search jobs, Sync, Queue, notifications, and profile.
- **Dashboard**: Airy summary page focused on one "Next best action", plus a slim SafeApplyManager rail and quiet Pipeline/Portal health previews.
- **Jobs**: Two-column split workbench. Left column is Review queue rows. Right column is Selected match detail with Tailor, Approve, Skip.
- **Tracker**: Stage tabs plus application rows and an in-page detail panel. Do not use a full Kanban wall.
- **Portals/Settings**: Management tabs with row-based portal statuses and form-based account/settings sections. Avoid tile walls.
- **Onboarding**: Top-nav app shell with a horizontal stepper: Resume, Preferences, Portals, Review.
- **Resume diff modal**: Full-screen overlay with two-panel side-by-side diff (original left, tailored draft right), generated artifact version/status, validation warnings, and line-level highlighting.
- **Modals**: Centered overlay, `--bg-elevated` background, backdrop blur, close on Escape.

## Icons

Lucide React. Stroke-based icons only.

| Context | Size |
| --- | --- |
| Inline text | `h-4 w-4` |
| Buttons | `h-4 w-4` |
| Portal status indicators | `h-5 w-5` |
| Empty state illustrations | `h-12 w-12` |

## Key UI Components

### App Shell

Authenticated pages use one top navigation shell:

- Hunter brand at far left
- Horizontal page tabs: Dashboard, Jobs, Tracker, Portals, Settings
- Search jobs input
- Sync button with syncing/synced state
- Queue button with count
- Notification button
- Profile menu

### JobRow And Selected Match

In the Jobs page, a scored job appears as a **JobRow** in the Review queue rather than a heavy standalone card. A row contains:

- Match score badge, color-coded by `--score-high/mid/low`
- Job title, company, location, portal badge
- Status and safety markers
- Compact action/overflow control

The Selected Match detail panel contains:

- JD summary
- AI fit bars
- Matched skills list and missing skills list
- Resume version
- SafeApplyManager note
- Three action buttons: **Tailor**, **Approve**, **Skip**

### PortalRow

Use **PortalRows**, not a grid of portal cards. Each row contains:

- Portal name
- Connection type: token or browser
- Status: connected, expired, manual login, not connected
- Last checked time
- Hidden credential note
- Compact action: Update, Confirm browser, Connect, or Disconnect

### Resume Diff Modal

Opens when the user clicks **Tailor** on a selected job. Shows side-by-side comparison of original vs generated tailored resume draft sections (summary + skills), the generated `.docx` draft version, validation result, and warnings. Uses `--font-mono` and line-level diff highlighting. Confirm button approves a real generated draft artifact for use in the next apply; it must not approve an empty URL or mutate the base resume.

### Application Tracker Row

Tracker uses stage tabs and rows, not draggable Kanban cards. Each row shows role, company, portal badge, score, latest update, status chip, and warning marker if needed. Clicking a row updates the in-page Application Details panel with timeline, resume version, apply response, notes, status selector, and Update/Close actions.
