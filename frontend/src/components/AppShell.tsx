import {
  Bell,
  BriefcaseBusiness,
  CheckCircle,
  Gauge,
  KanbanSquare,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  User,
  X,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { type FormEvent, useState } from "react";
import { BrandMark } from "./BrandMark";
import { useToast } from "./Toast";

interface AppShellProps {
  children: React.ReactNode;
  metrics: {
    matches: number;
    approved: number;
    applied: number;
    blocked: number;
  };
  portalIssues?: Array<{ portal: string; name: string; message: string }>;
  onSync?: () => void | Promise<unknown>;
  onSearch?: (query: string) => void | Promise<void>;
  searchLoading?: boolean;
  autoSyncState?: "idle" | "syncing" | "paused";
  lastAutoSyncedAt?: string;
}

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: Gauge },
  { label: "Jobs", path: "/jobs", icon: BriefcaseBusiness },
  { label: "Tracker", path: "/tracker", icon: KanbanSquare },
  { label: "Portals", path: "/portals", icon: Link2 },
  { label: "Settings", path: "/settings", icon: Settings },
];

function formatLastSync(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AppShell({
  children,
  metrics,
  portalIssues = [],
  onSync,
  onSearch,
  searchLoading = false,
  autoSyncState = "idle",
  lastAutoSyncedAt = "",
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done">("idle");
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const showGlobalSearch = location.pathname !== "/jobs";
  const syncBusy = syncState === "syncing" || autoSyncState === "syncing";
  const syncLabel = syncState === "done" ? "Updated" : autoSyncState === "paused" ? "Paused" : syncBusy ? "Syncing" : "Auto sync";
  const syncTimeLabel = formatLastSync(lastAutoSyncedAt);
  const syncTitle = `Auto sync refreshes saved matches and Tracker status. It never searches, applies, or opens portals.${syncTimeLabel ? ` Last refresh: ${syncTimeLabel}.` : ""} Click to refresh now.`;

  const runSync = async () => {
    if (syncState === "syncing") return;
    setSyncState("syncing");
    try {
      await onSync?.();
      setSyncState("done");
    } finally {
      window.setTimeout(() => setSyncState("idle"), 1600);
    }
  };

  const signOut = () => {
    localStorage.removeItem("access_token");
    toast.success("Signed out.");
    navigate("/auth");
  };

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate("/jobs");
    await onSearch?.(query);
  };

  const closeMenus = () => {
    setProfileOpen(false);
    setNotificationsOpen(false);
    setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/95 backdrop-blur">
        <div className="air-container flex min-h-16 flex-wrap items-center gap-3 py-3">
          <button type="button" onClick={() => navigate("/dashboard")} className="mr-1 shrink-0 text-left">
            <BrandMark />
          </button>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                    isActive
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                  }`
                }
              >
                <item.icon size={15} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            title="Open navigation"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] lg:hidden"
          >
            <Menu size={16} />
          </button>

          {showGlobalSearch ? (
            <form onSubmit={runSearch} role="search" className="relative order-last w-full flex-1 lg:order-none lg:ml-auto lg:max-w-lg" aria-busy={searchLoading}>
              {searchLoading ? (
                <LoaderCircle size={16} className="absolute left-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--accent-primary)]" />
              ) : (
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              )}
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                disabled={searchLoading}
                className={`terminal-field h-10 w-full rounded-lg pl-9 pr-28 text-sm shadow-sm disabled:cursor-wait disabled:opacity-90 ${searchLoading ? "border-[var(--accent-primary)] bg-[var(--bg-elevated)]" : ""}`}
                placeholder="Search jobs or use profile"
              />
              <button
                type="submit"
                disabled={searchLoading}
                className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 rounded-md bg-[var(--accent-primary)] px-3 text-xs font-semibold text-white transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {searchLoading && <LoaderCircle size={12} className="animate-spin" />}
                {searchLoading ? "Finding" : searchQuery.trim() ? "Search" : "Find"}
              </button>
            </form>
          ) : (
            <div className="hidden flex-1 lg:block" />
          )}

          <button
            type="button"
            onClick={() => void runSync()}
            title={syncTitle}
            aria-label={syncTitle}
            className={`air-button h-9 border bg-[var(--bg-surface)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)] ${
              syncBusy ? "border-[var(--accent-primary)] text-[var(--accent-primary)]" : "border-[var(--border-default)]"
            }`}
          >
            <RefreshCw size={15} className={syncBusy ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{syncLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/jobs")}
            className="air-button h-9 border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
          >
            Ready
            <span className="rounded-full bg-[var(--accent-primary)] px-2 py-0.5 text-xs font-semibold text-white">{metrics.approved}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/tracker?status=applied")}
            className="air-button h-9 border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-[var(--text-primary)] hover:border-[var(--state-success)]"
          >
            <CheckCircle size={15} style={{ color: "var(--state-success)" }} />
            <span className="hidden sm:inline">Applied</span>
            <span className="rounded-full bg-[var(--state-success)] px-2 py-0.5 text-xs font-semibold text-white">{metrics.applied}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setNotificationsOpen((open) => !open);
              setProfileOpen(false);
            }}
            aria-label="Notifications"
            title="Notifications"
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)]"
          >
            <Bell size={16} />
            {(metrics.blocked > 0 || portalIssues.length > 0) && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--state-warning)]" />}
          </button>

          <button
            type="button"
            onClick={() => {
              setProfileOpen((open) => !open);
              setNotificationsOpen(false);
            }}
            aria-label="Profile"
            title="Profile"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] text-sm font-semibold"
          >
            AK
          </button>

          {(notificationsOpen || profileOpen) && (
            <button type="button" aria-label="Close menu" className="fixed inset-0 z-30 cursor-default bg-transparent" onClick={closeMenus} />
          )}

          {notificationsOpen && (
            <div className="absolute right-20 top-[calc(100%+8px)] z-40 w-[min(380px,calc(100vw-32px))] rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-xl">
              <p className="text-sm font-semibold">Notifications</p>
              <div className="mt-3 space-y-1 text-sm">
                {portalIssues.map((issue) => (
                  <button key={issue.portal} type="button" onClick={() => { navigate(`/portals?connect=${issue.portal}`); closeMenus(); }} className="block w-full rounded-md p-3 text-left hover:bg-[var(--bg-elevated)]">
                    <span className="font-medium">{issue.name} needs re-login</span>
                    <span className="mt-1 block text-xs text-[var(--text-muted)]">{issue.message}</span>
                  </button>
                ))}
                <button type="button" onClick={() => { navigate("/jobs"); closeMenus(); }} className="block w-full rounded-md p-3 text-left hover:bg-[var(--bg-elevated)]">
                  <span className="font-medium">{metrics.matches} matches ready</span>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">Review before opening the portal.</span>
                </button>
              </div>
            </div>
          )}

          {profileOpen && (
            <div className="absolute right-6 top-[calc(100%+8px)] z-40 w-60 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 shadow-xl">
              <button type="button" onClick={() => { navigate("/onboarding"); closeMenus(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--bg-elevated)]">
                <User size={15} />
                Onboarding
              </button>
              <button type="button" onClick={() => { navigate("/settings"); closeMenus(); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--bg-elevated)]">
                <Settings size={15} />
                Settings
              </button>
              <button type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--state-error)] hover:bg-[var(--bg-elevated)]">
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="air-container py-6">{children}</main>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close navigation backdrop" className="absolute inset-0 bg-slate-900/30" onClick={() => setMobileNavOpen(false)} />
          <aside className="relative h-full w-[min(320px,86vw)] border-r border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-[var(--border-default)] px-4">
              <BrandMark />
              <button type="button" aria-label="Close navigation" title="Close navigation" onClick={() => setMobileNavOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)]">
                <X size={16} />
              </button>
            </div>
            <nav className="space-y-1 p-3">
              {navItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setMobileNavOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-md px-3 py-3 text-sm ${
                      isActive ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    }`
                  }
                >
                  <item.icon size={16} />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mx-3 mt-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle size={16} style={{ color: "var(--state-success)" }} />
                Apply checks
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">The app curates jobs and tracks portal submissions after you confirm them.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
