# Feature Spec 14 — React Frontend

## What This Is

The React 18 SPA with authenticated product pages for onboarding, dashboard, job review, tracker, portals, and settings. Built with Tailwind CSS and the approved Air Workbench direction. All API calls go through a single axios client with JWT interceptor.

MVP live wiring rule: authenticated app state must come from FastAPI/Supabase, not `mockData`, `demo-token`, or local-only transitions. Mock data may remain only for isolated visual tests, not as the runtime source for authenticated pages.

## Prerequisites

- `13-api-routes.md` complete (backend running at localhost:8000)
- Node.js 18+ installed
- `frontend/` directory

---

## Implementation Steps

### MVP Live Wiring Update

Before adding new UI features, wire the existing Air Workbench UI to real backend routes:

- Auth calls `/api/auth/login` and `/api/auth/register`; it must not set `demo-token`.
- Onboarding upload calls `/api/resume/upload` and displays parsed resume data.
- Preferences load/save through `/api/preferences`; MVP saves manual portal workflow settings and keeps auto-submit disabled.
- Jobs load `/api/jobs/matches`; Skip, Tailor, Tailor approve, and Open portal call the matching job routes.
- The app-shell/Jobs search input calls `POST /api/jobs/search` for Manual Job Search. It must not be a cosmetic text box or a local-only filter. Press Enter and the Search action should fetch, score, save, and refresh live matches.
- Tracker loads `/api/applications` and updates statuses through `PATCH /api/applications/{id}`.
- Portals load `/api/portals/status` and save portal/company account data through existing API helpers.
- Naukri uses guided Connect as the primary path: `POST /api/portals/naukri/connect/start`, poll `/api/portals/naukri/connect/status`, show **Waiting** while the backend browser login is in progress, then refresh `/api/portals/status` after success.
- Manual Naukri token/profile entry must be presented as **Advanced manual setup**, not as the default connection flow.
- Authenticated pages must support loading, empty, error, and success states from real API responses.
- Open portal should communicate that Hunter is creating a Tracker task and opening the original source job page; it must not imply unattended form submission.
- Jobs with `status='external_pending'` must show **Portal pending** and **Open portal**. Tracker must include a **Portal pending** stage with source URL, portal/source, reason, and actions for **I applied** and **Could not apply**.
- Auto-submit controls must be hidden or disabled in MVP. Existing auto-apply settings remain dormant for future verified official/native flows.

### Step 1 — Project Setup

```bash
cd frontend
npx create-react-app . --template typescript
npm install axios react-router-dom react-dropzone lucide-react
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

`tailwind.config.js`:
```js
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "bg-base":     "var(--bg-base)",
        "bg-surface":  "var(--bg-surface)",
        "bg-elevated": "var(--bg-elevated)",
        "accent":      "var(--accent-primary)",
        "accent-hover":"var(--accent-hover)",
      },
      fontFamily: {
        sans: ["Geist", "Inter", "sans-serif"],
        mono: ["Geist Mono", "monospace"],
      },
    },
  },
  plugins: [],
}
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root,
:root[data-theme="dark"] {
  --bg-base: #0d0d0d;
  --bg-surface: #161616;
  --bg-elevated: #1f1f1f;
  --text-primary: #f0f0f0;
  --text-muted: #6b7280;
  --accent-primary: #6366f1;
  --accent-hover: #4f46e5;
  --state-success: #22c55e;
  --state-warning: #f59e0b;
  --state-error: #ef4444;
  --border-default: #2a2a2a;
  --score-high: #22c55e;
  --score-mid: #f59e0b;
  --score-low: #ef4444;
  color-scheme: dark;
}

:root[data-theme="light"] {
  --bg-base: #f7f8fb;
  --bg-surface: #ffffff;
  --bg-elevated: #f1f5f9;
  --text-primary: #111827;
  --text-muted: #64748b;
  --accent-primary: #4f46e5;
  --accent-hover: #4338ca;
  --state-success: #16a34a;
  --state-warning: #d97706;
  --state-error: #dc2626;
  --border-default: #d8dee9;
  --score-high: #16a34a;
  --score-mid: #d97706;
  --score-low: #dc2626;
  color-scheme: light;
}

body {
  background-color: var(--bg-base);
  color: var(--text-primary);
}
```

Theme behavior:

- Default to dark theme for the first run.
- Store the user's selection in `localStorage` as `hunter_theme`.
- Apply the theme by setting `document.documentElement.dataset.theme` to `dark` or `light`.
- Put the theme toggle in the authenticated app shell user/profile area and the public auth/home pages.
- Use only semantic CSS variables in components; do not hardcode theme-specific colors in JSX except for transparent overlays like `bg-black/40`.
- Light mode should keep the same dense operational layout. It is not a separate marketing-style skin.

---

### Step 2 — `src/api/client.ts`

```typescript
import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:8000",
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("access_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  login: (email: string, password: string) =>
    api.post("/api/auth/login", { email, password }),
  register: (email: string, password: string) =>
    api.post("/api/auth/register", { email, password }),
};

export const resumeAPI = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/api/resume/upload", form);
  },
  getParsed: () => api.get("/api/resume/parsed"),
};

export const preferencesAPI = {
  save: (prefs: object) => api.post("/api/preferences", prefs),
  get: () => api.get("/api/preferences"),
};

export const portalsAPI = {
  getStatus: () => api.get("/api/portals/status"),
  saveNaukriToken: (bearer_token: string, profile_id: string) =>
    api.post("/api/portals/naukri/token", { bearer_token, profile_id }),
  saveFounditToken: (bearer_token: string, user_id_str: string) =>
    api.post("/api/portals/foundit/token", { bearer_token, user_id_str }),
  confirmLinkedIn: () => api.post("/api/portals/linkedin/setup"),
};

export const jobsAPI = {
  getMatches: () => api.get("/api/jobs/matches"),
  search: (payload: {
    query: string;
    locations?: string[];
    experience_years?: number;
    portals?: string[];
    max_pages?: number;
    results_per_page?: number;
    min_score?: number;
    freshness_days?: number;
    save_as_preferences?: boolean;
  }) => api.post("/api/jobs/search", payload),
  approve: (id: string) => api.post(`/api/jobs/${id}/approve`),
  skip: (id: string) => api.post(`/api/jobs/${id}/skip`),
  tailor: (id: string) => api.post(`/api/jobs/${id}/tailor`),
  approveTailored: (id: string, tailored_resume_id: string) =>
    api.post(`/api/jobs/${id}/tailor/approve`, { tailored_resume_id }),
  apply: (id: string) => api.post(`/api/jobs/${id}/apply`),
};

export const applicationsAPI = {
  getAll: () => api.get("/api/applications"),
  updateStatus: (id: string, status: string, notes?: string) =>
    api.patch(`/api/applications/${id}`, { status, notes }),
};

export const companyAccountsAPI = {
  save: (company_key: string, username: string, password: string) =>
    api.post("/api/company-accounts", { company_key, username, password }),
  getAll: () => api.get("/api/company-accounts"),
  checkStatus: (company_key: string) =>
    api.get(`/api/company-accounts/${company_key}/status`),
  delete: (company_key: string) =>
    api.delete(`/api/company-accounts/${company_key}`),
};

export default api;
```

---

### Step 3 — `src/App.tsx` (routing)

```typescript
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Tracker } from "./pages/Tracker";
import { Settings } from "./pages/Settings";

function PrivateRoute({ children }: { children: JSX.Element }) {
  const token = localStorage.getItem("access_token");
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<PrivateRoute><Onboarding /></PrivateRoute>} />
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/tracker" element={<PrivateRoute><Tracker /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

---

### Step 4 — Key Pages

**`src/pages/Dashboard.tsx`** — core page showing job matches:

```typescript
import { useEffect, useState } from "react";
import { jobsAPI } from "../api/client";
import { JobCard } from "../components/JobCard";
import { TailorModal } from "../components/TailorModal";

export function Dashboard() {
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tailorMatch, setTailorMatch] = useState<any>(null);

  useEffect(() => {
    jobsAPI.getMatches().then((res) => {
      setMatches(res.data.matches);
      setLoading(false);
    });
  }, []);

  const handleApprove = async (match: any) => {
    await jobsAPI.approve(match.id);
    setMatches((prev) => prev.map((m) => m.id === match.id ? { ...m, status: "approved" } : m));
  };

  const handleSkip = async (match: any) => {
    await jobsAPI.skip(match.id);
    setMatches((prev) => prev.filter((m) => m.id !== match.id));
  };

  const handleApply = async (match: any) => {
    await jobsAPI.apply(match.id);
    setMatches((prev) => prev.map((m) => m.id === match.id ? { ...m, status: "applied" } : m));
  };

  if (loading) return <div className="text-[var(--text-muted)] p-8">Loading matches...</div>;

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-6">
        Today's Matches
        <span className="ml-3 text-sm text-[var(--text-muted)] font-normal">
          {matches.filter(m => m.status === "pending").length} pending
        </span>
      </h1>

      {matches.length === 0 ? (
        <div className="text-[var(--text-muted)] text-center mt-20">
          No matches yet. The scheduler runs daily at 8am IST.
        </div>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {matches.map((match) => (
            <JobCard
              key={match.id}
              match={match}
              onApprove={() => handleApprove(match)}
              onSkip={() => handleSkip(match)}
              onTailor={() => setTailorMatch(match)}
              onApply={() => handleApply(match)}
            />
          ))}
        </div>
      )}

      {tailorMatch && (
        <TailorModal match={tailorMatch} onClose={() => setTailorMatch(null)} />
      )}
    </div>
  );
}
```

---

### Step 5 — Key Components

**`src/components/JobCard.tsx`**:

```typescript
import { CheckCircle, XCircle, FileText, Send } from "lucide-react";

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80
    ? "var(--score-high)"
    : score >= 60
    ? "var(--score-mid)"
    : "var(--score-low)";
  return (
    <span className="text-sm font-bold px-2 py-1 rounded" style={{ color, border: `1px solid ${color}` }}>
      {score}%
    </span>
  );
}

export function JobCard({ match, onApprove, onSkip, onTailor, onApply }: any) {
  const job = match.jobs;
  const isApproved = match.status === "approved";
  const isApplied = match.status === "applied";

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[var(--text-primary)] font-semibold">{job.title}</h3>
          <p className="text-[var(--text-muted)] text-sm">{job.company} · {job.location}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide border border-[var(--border-default)] px-2 py-0.5 rounded">
            {job.portal}
          </span>
          <ScoreBadge score={match.match_score} />
        </div>
      </div>

      {match.matched_skills?.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {match.matched_skills.slice(0, 6).map((s: string) => (
            <span key={s} className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400">
              {s}
            </span>
          ))}
          {match.missing_skills?.slice(0, 3).map((s: string) => (
            <span key={s} className="text-xs px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)]">
              {s}
            </span>
          ))}
        </div>
      )}

      {isApplied ? (
        <p className="text-sm text-green-400 mt-3">✓ Applied</p>
      ) : (
        <div className="flex gap-2 mt-4">
          {!isApproved ? (
            <button onClick={onApprove}
              className="px-3 py-1.5 text-sm bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-white rounded-md flex items-center gap-1">
              <CheckCircle size={14} /> Approve
            </button>
          ) : (
            <button onClick={onApply}
              className="px-3 py-1.5 text-sm bg-green-700 hover:bg-green-600 text-white rounded-md flex items-center gap-1">
              <Send size={14} /> Apply Now
            </button>
          )}
          <button onClick={onTailor}
            className="px-3 py-1.5 text-sm border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md flex items-center gap-1">
            <FileText size={14} /> Tailor Resume
          </button>
          <button onClick={onSkip}
            className="px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-red-400 rounded-md flex items-center gap-1">
            <XCircle size={14} /> Skip
          </button>
        </div>
      )}
    </div>
  );
}
```

**`src/pages/Tracker.tsx`** — Kanban board:

```typescript
import { useEffect, useState } from "react";
import { applicationsAPI } from "../api/client";

const COLUMNS = ["applied", "viewed", "interview", "rejected"];
const COLUMN_LABELS: Record<string, string> = {
  applied: "Applied", viewed: "Viewed", interview: "Interview", rejected: "Rejected"
};

export function Tracker() {
  const [applications, setApplications] = useState<any[]>([]);

  useEffect(() => {
    applicationsAPI.getAll().then((res) => setApplications(res.data.applications));
  }, []);

  const updateStatus = async (id: string, status: string) => {
    await applicationsAPI.updateStatus(id, status);
    setApplications((prev) => prev.map((a) => a.id === id ? { ...a, status } : a));
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-6">Application Tracker</h1>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <div key={col} className="min-w-[280px] bg-[var(--bg-surface)] rounded-lg p-4 border border-[var(--border-default)]">
            <h2 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
              {COLUMN_LABELS[col]}
              <span className="ml-2 text-[var(--text-primary)]">
                {applications.filter((a) => a.status === col).length}
              </span>
            </h2>
            <div className="space-y-2">
              {applications
                .filter((a) => a.status === col)
                .map((app) => (
                  <div key={app.id}
                    className="bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg p-3">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {app.jobs?.title || "Unknown"}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {app.jobs?.company} · {app.portal}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {new Date(app.applied_at).toLocaleDateString()}
                    </p>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {COLUMNS.filter((c) => c !== col).map((c) => (
                        <button key={c} onClick={() => updateStatus(app.id, c)}
                          className="text-xs px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          → {COLUMN_LABELS[c]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## Testing

```bash
cd frontend
npm start     # starts at localhost:3000

# Verify:
# 1. Login page loads at /login
# 2. After login, redirects to /dashboard
# 3. Dashboard shows loading state then matches (or empty state message)
# 4. Approve button changes to Apply Now
# 5. Skip removes the card
# 6. Tracker shows Kanban with 4 columns
# 7. Status update buttons move cards between columns
# 8. Settings portal cards show connected/not-connected state
# 9. Theme toggle switches dark/light without losing route or auth state
# 10. Light theme has readable contrast for cards, inputs, badges, and modals
# 11. Manual search: type `backend developer`, press Enter/Search, see searching state, then new scored matches or an actionable blocker

npm run build  # must pass before declaring feature complete
```

---

## Expected Success Behaviour

- Login → JWT stored → redirect to Dashboard
- Dashboard loads matches sorted by score (highest first)
- Top-bar/Jobs search runs a real manual search through `/api/jobs/search` and refreshes matches after completion
- JobCard shows colour-coded score badge, matched skills (green), missing skills (grey)
- Approve → button changes to "Apply Now"
- External pending jobs show **Open company site** and remain pending until the user confirms in Tracker
- Apply → card shows "✓ Applied" after response
- Skip → card disappears from the list
- Tracker Kanban has 4 columns, cards move when status buttons clicked
- Theme preference persists across reloads and both themes use the same semantic tokens
- `npm run build` completes with no errors or TypeScript errors

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| 401 on every API call | Token not set or expired | Check `localStorage.getItem("access_token")`; re-login |
| Dashboard empty with no message | `matches` is `undefined` not `[]` | Check `res.data.matches` — fallback to `[]` |
| Tracker shows all cards in "applied" | Status filter not working | Verify `a.status === col` comparison; check DB status values |
| CORS error on API call | Backend CORS not configured for localhost:3000 | Verify `FRONTEND_URL=http://localhost:3000` in backend `.env` |
| `npm run build` TypeScript errors | Missing types or wrong interface | Add missing type assertions or install `@types/...` packages |

## Challenges

- **Apply is async**: The `/api/jobs/{id}/apply` call returns immediately with "Apply started." The actual portal apply can still take time. The frontend must handle this gracefully — show a checking/applying state on the card and let the user check the Tracker for the result.
- **Safe auto sync**: The app refreshes persisted matches and Tracker applications in the background while the authenticated tab is visible. This is read-only live-data refresh; it must not call job search, open portals, submit applications, or touch dormant auto-apply handlers.
- **Manual search is not auto sync**: The Search action sends the user's query to `/api/jobs/search` and can fetch new jobs. Auto sync only refreshes already-known live data through `/api/jobs/matches`, `/api/applications`, and occasional portal status checks.
- **Onboarding flow**: The Onboarding page (resume upload + preferences) is the first page a new user sees. After upload, show the parsed data for the user to review/correct before saving. Gate the Dashboard behind "resume uploaded + preferences set."
- **Token expiry UX**: If the user's Naukri token expires, they need to know. The Settings page should show "⚠ Token expired" on the Naukri card with a "Reconnect" button that explains how to get a new Bearer token from DevTools.
