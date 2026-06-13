import {
  BriefcaseBusiness,
  CheckSquare,
  Gauge,
  KanbanSquare,
  Link2,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { type FormEvent, useState } from "react";
import { BrandMark } from "./BrandMark";
import { Spinner } from "./ui/spinner";
import { useToast } from "./Toast";
import { FamilyButton } from "./ui/family-button";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./ui/hover-card";
import { clearCurrentUserProfile, currentUserEmail, currentUserName, userInitials } from "@/lib/session";

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
  userProfile?: {
    name?: string;
    email?: string;
  };
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
  onSync,
  onSearch,
  searchLoading = false,
  autoSyncState = "idle",
  lastAutoSyncedAt = "",
  userProfile,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const userEmail = userProfile?.email || currentUserEmail();
  const userName = userProfile?.name || currentUserName();
  const initials = userInitials(userName);

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
    clearCurrentUserProfile();
    toast.success("Signed out.");
    navigate("/auth");
  };

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate("/jobs");
    await onSearch?.(query);
  };

  const navLinkClass = (isActive: boolean) =>
    `w-full py-2.5 px-3.5 rounded-xl flex items-center gap-2.5 text-xs font-bold transition-all ${
      isActive
        ? "bg-brand-pine text-white shadow-sm hover:bg-brand-pine/90"
        : "text-zinc-550 hover:text-brand-pine hover:bg-brand-chalk/80"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-brand-linen font-sans text-brand-pine antialiased md:h-screen md:flex-row md:overflow-hidden">
      {/* Sidebar nav rail */}
      <aside className="relative z-30 flex w-full shrink-0 flex-col justify-between border-r border-brand-border bg-white md:w-64">
        <div>
          <div className="flex h-16 items-center justify-between border-b border-brand-border/60 px-6">
            <button type="button" onClick={() => navigate("/dashboard")} className="text-left">
              <BrandMark eyebrow="Job Console" />
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label="Toggle navigation"
              className="text-zinc-500 hover:text-brand-pine md:hidden"
            >
              {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          <nav className={`space-y-1.5 p-4 md:block ${mobileNavOpen ? "block" : "hidden"}`}>
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => setMobileNavOpen(false)}
                className={({ isActive }) => navLinkClass(isActive)}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className={`border-t border-zinc-100 p-4 md:block ${mobileNavOpen ? "block" : "hidden"}`}>
          <HoverCard openDelay={120} closeDelay={120}>
            <HoverCardTrigger asChild>
              <button type="button" className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-zinc-200/60 bg-brand-linen p-3 text-left transition hover:border-brand-pine/30 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-clay/30">
                <Avatar className="h-8 w-8 rounded-xl">
                  <AvatarFallback className="rounded-xl bg-zinc-950 font-sans text-xs font-bold text-white">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-xs font-extrabold text-brand-pine">{userName || "Hunter workspace"}</h4>
                  <p className="truncate font-mono text-[10px] text-zinc-450">{userEmail || "Local session"}</p>
                </div>
              </button>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="end" sideOffset={12} className="w-72 rounded-2xl border-brand-border bg-white p-4 shadow-xl">
              <div className="flex items-start gap-3">
                <Avatar className="h-11 w-11 rounded-xl">
                  <AvatarFallback className="rounded-xl bg-zinc-950 font-sans text-sm font-bold text-white">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-brand-pine">{userName || "Hunter workspace"}</p>
                  <p className="truncate font-mono text-[11px] text-zinc-450">{userEmail || "Local session"}</p>
                  <p className="mt-1 text-xs font-medium text-zinc-500">Active Hunter session</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-brand-border bg-brand-chalk p-2 text-center">
                  <p className="font-mono text-[10px] font-black text-brand-pine">{metrics.matches}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-zinc-500">Matches</p>
                </div>
                <div className="rounded-xl border border-brand-border bg-brand-chalk p-2 text-center">
                  <p className="font-mono text-[10px] font-black text-brand-pine">{metrics.approved}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-zinc-500">Ready</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-2 text-center">
                  <p className="font-mono text-[10px] font-black text-emerald-700">{metrics.applied}</p>
                  <p className="mt-0.5 text-[10px] font-bold text-emerald-700">Applied</p>
                </div>
              </div>

            </HoverCardContent>
          </HoverCard>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold text-rose-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
          >
            <LogOut className="h-4 w-4" /> Log Out Session
          </button>
        </div>
      </aside>

      {/* Content frame */}
      <main className="relative flex min-w-0 flex-1 flex-col md:min-h-0">
        <header className="grid min-h-16 shrink-0 grid-cols-1 items-center gap-3 border-b border-brand-border/60 bg-white px-4 py-3 sm:px-6 lg:h-16 lg:grid-cols-[minmax(0,1fr)_minmax(340px,560px)_minmax(0,1fr)] lg:py-0">
          <div className="hidden min-w-0 items-center gap-2.5 lg:flex">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-400">Role profile:</span>
            <span className="inline-flex items-center gap-1 rounded border border-brand-border bg-brand-chalk px-2.5 py-1 font-mono text-[10px] font-bold text-brand-pine">
              <CheckSquare className="h-3 w-3 text-brand-clay" /> {metrics.matches} matches
            </span>
            {syncTimeLabel && (
              <span className="font-mono text-[10px] text-zinc-400" title="When Hunter last refreshed your matches and tracker">
                &middot; Synced {syncTimeLabel}
              </span>
            )}
          </div>

          {showGlobalSearch ? (
            <form onSubmit={runSearch} role="search" className="relative w-full lg:col-start-2 lg:row-start-1 lg:justify-self-center" aria-busy={searchLoading}>
              {searchLoading ? (
                <Spinner className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-clay" />
              ) : (
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              )}
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                disabled={searchLoading}
                className={`h-10 w-full rounded-xl border bg-white pl-9 pr-24 text-sm shadow-sm outline-none transition focus:border-brand-pine disabled:cursor-wait disabled:opacity-90 ${
                  searchLoading ? "border-brand-clay bg-brand-chalk" : "border-brand-border"
                }`}
                placeholder="Search jobs or use profile"
              />
              <button
                type="submit"
                disabled={searchLoading}
                className="absolute right-1 top-1/2 inline-flex h-8 -translate-y-1/2 items-center gap-1 rounded-lg bg-brand-pine px-3 text-xs font-semibold text-white transition hover:bg-brand-pine-deep disabled:cursor-not-allowed disabled:opacity-55"
              >
                {searchLoading ? <Spinner className="size-3" /> : <Sparkles size={12} />}
                {searchLoading ? "Finding" : searchQuery.trim() ? "Search" : "Find"}
              </button>
            </form>
          ) : (
            <div className="hidden lg:col-start-2 lg:row-start-1 lg:block" />
          )}

          <div className="flex items-center gap-2 justify-self-end lg:col-start-3 lg:row-start-1">
            <button
              type="button"
              onClick={() => void runSync()}
              title={syncTitle}
              aria-label={syncTitle}
              className={`air-button h-9 rounded-xl border bg-white px-3 text-brand-pine transition hover:border-brand-pine ${
                syncBusy ? "border-brand-clay text-brand-clay" : "border-brand-border"
              }`}
            >
              {syncBusy ? <Spinner className="size-[15px]" /> : <RefreshCw size={15} />}
              <span className="hidden sm:inline">{syncLabel}</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-x-hidden overflow-y-auto md:min-h-0">
          <div className="mx-auto min-w-0 w-full max-w-[1536px] p-4 sm:p-6 lg:p-8">{children}</div>
        </div>
      </main>

      <FamilyButton
        actions={[
          { icon: <Search size={16} />, label: "Search jobs", onClick: () => navigate("/jobs") },
          { icon: <RefreshCw size={16} />, label: "Sync now", onClick: () => void runSync() },
          { icon: <KanbanSquare size={16} />, label: "Open Tracker", onClick: () => navigate("/tracker") },
          { icon: <Link2 size={16} />, label: "Manage portals", onClick: () => navigate("/portals") },
        ]}
      />
    </div>
  );
}
