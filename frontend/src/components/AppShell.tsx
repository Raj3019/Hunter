import {
  Bell,
  BriefcaseBusiness,
  CheckCircle,
  Gauge,
  KanbanSquare,
  Link2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  User,
  X,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { BrandMark } from "./BrandMark";

interface AppShellProps {
  children: React.ReactNode;
  metrics: {
    matches: number;
    approved: number;
    applied: number;
    blocked: number;
  };
}

const navItems = [
  { label: "Dashboard", path: "/dashboard", icon: Gauge },
  { label: "Jobs", path: "/jobs", icon: BriefcaseBusiness },
  { label: "Tracker", path: "/tracker", icon: KanbanSquare },
  { label: "Portals", path: "/portals", icon: Link2 },
  { label: "Settings", path: "/settings", icon: Settings },
];

export function AppShell({ children, metrics }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done">("idle");
  const navigate = useNavigate();

  const runSync = () => {
    setSyncState("syncing");
    window.setTimeout(() => setSyncState("done"), 700);
    window.setTimeout(() => setSyncState("idle"), 2200);
  };

  const signOut = () => {
    localStorage.removeItem("access_token");
    navigate("/auth");
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

          <div className="relative order-last w-full flex-1 lg:order-none lg:ml-auto lg:max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="terminal-field h-9 w-full rounded-md pl-9 pr-3 text-sm" placeholder="Search jobs, companies, applications" />
          </div>

          <button
            type="button"
            onClick={runSync}
            className="air-button h-9 border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
          >
            <RefreshCw size={15} className={syncState === "syncing" ? "animate-spin" : ""} />
            <span className="hidden sm:inline">{syncState === "done" ? "Synced" : syncState === "syncing" ? "Syncing" : "Sync"}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/tracker")}
            className="air-button h-9 border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
          >
            Ready
            <span className="rounded-full bg-[var(--accent-primary)] px-2 py-0.5 text-xs font-semibold text-white">{metrics.approved}</span>
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
            {metrics.blocked > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--state-warning)]" />}
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
                <button type="button" onClick={() => { navigate("/portals"); closeMenus(); }} className="block w-full rounded-md p-3 text-left hover:bg-[var(--bg-elevated)]">
                  <span className="font-medium">Portal check needed</span>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">Foundit token needs reconnect.</span>
                </button>
                <button type="button" onClick={() => { navigate("/jobs"); closeMenus(); }} className="block w-full rounded-md p-3 text-left hover:bg-[var(--bg-elevated)]">
                  <span className="font-medium">{metrics.matches} matches ready</span>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">Review before applying.</span>
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
              <p className="mt-2 text-xs text-[var(--text-muted)]">The app checks session, limits, and duplicates before applying.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
