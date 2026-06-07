import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle, LoaderCircle, Search, Send, Sparkles, XCircle } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { Auth } from "./pages/Auth";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Jobs } from "./pages/Jobs";
import { Tracker } from "./pages/Tracker";
import { Portals } from "./pages/Portals";
import { Settings } from "./pages/Settings";
import { apiErrorMessage, applicationsAPI, jobsAPI, portalsAPI } from "./api/client";
import { mapApplication, mapJobMatch } from "./api/mappers";
import type { Application, ApplicationStatus, JobMatch, SearchRunSummary } from "./types";
import { isExternalApplyJob, openExternalApply } from "./utils/jobApply";

function isAuthed() {
  return Boolean(localStorage.getItem("access_token"));
}

function PrivateRoute({ children }: { children: JSX.Element }) {
  const location = useLocation();
  return isAuthed() ? children : <Navigate to="/auth" replace state={{ from: location.pathname }} />;
}

type LiveDataSnapshot = {
  jobs: JobMatch[];
  applications: Application[];
};

type PendingApply = {
  matchId: string;
  jobId: string;
  title: string;
  company: string;
  portal: string;
};

type ApplyNotice = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
  showTrackerAction?: boolean;
  action?: "tracker" | "portal";
  actionLabel?: string;
  portalKey?: string;
  trackerStatus?: ApplicationStatus;
  // One-tap portal-outcome confirmation (shown right after Open portal).
  confirmable?: boolean;
  applicationId?: string;
  matchId?: string;
  jobId?: string;
};

type PortalIssue = {
  portal: string;
  name: string;
  message: string;
  checked: string;
};

type ManualSearchOptions = {
  locations?: string[];
  minScore?: number;
};

type RefreshOptions = {
  silent?: boolean;
};

type AutoSyncState = "idle" | "syncing" | "paused";

const AUTO_SYNC_INTERVAL_MS = 60_000;
const PORTAL_HEALTH_AUTO_SYNC_INTERVAL_MS = 10 * 60_000;
const NAUKRI_APPLY_SYNC_INTERVAL_MS = 5 * 60_000;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingLiveData, setLoadingLiveData] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [manualSearchLoading, setManualSearchLoading] = useState(false);
  const [manualSearchNotice, setManualSearchNotice] = useState("");
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [lastSearchSummary, setLastSearchSummary] = useState<SearchRunSummary | null>(null);
  const [searchResultIds, setSearchResultIds] = useState<string[] | null>(null);
  const [applyNotice, setApplyNotice] = useState<ApplyNotice | null>(null);
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [portalIssues, setPortalIssues] = useState<PortalIssue[]>([]);
  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState>("idle");
  const [lastAutoSyncedAt, setLastAutoSyncedAt] = useState("");
  const activeApplyRef = useRef<string | null>(null);
  const liveSyncInFlightRef = useRef(false);
  const portalSyncInFlightRef = useRef(false);
  const lastPortalHealthSyncAtRef = useRef(0);
  const jobsRef = useRef<JobMatch[]>([]);
  const lastNaukriSyncAtRef = useRef(0);
  const naukriSyncInFlightRef = useRef(false);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const refreshLiveData = useCallback(async (options: RefreshOptions = {}): Promise<LiveDataSnapshot | undefined> => {
    if (!isAuthed()) return undefined;
    if (liveSyncInFlightRef.current) return undefined;

    liveSyncInFlightRef.current = true;
    if (!options.silent) {
      setLoadingLiveData(true);
      setLiveError("");
    }
    try {
      // Job search results are session-only (ephemeral) and live in `jobs`.
      // Background refresh only syncs persisted applications (the Tracker); it must
      // not reload or overwrite the review queue, or stored jobs would reappear.
      const applicationsResponse = await applicationsAPI.getAll();
      const nextApplications = (applicationsResponse.data?.applications || []).map(mapApplication);
      setApplications(nextApplications);
      setLastAutoSyncedAt(new Date().toISOString());
      return { jobs: jobsRef.current, applications: nextApplications };
    } catch (caught) {
      if (!options.silent) {
        setLiveError(apiErrorMessage(caught, "Could not load live Hunter data."));
      }
      return undefined;
    } finally {
      liveSyncInFlightRef.current = false;
      if (!options.silent) {
        setLoadingLiveData(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshLiveData();
  }, [location.key, refreshLiveData]);

  // Read-only: ask Naukri which jobs the user has applied to and auto-advance
  // matching portal-pending tasks. Throttled; safe to call often.
  const syncNaukriApplied = useCallback(async (force = false): Promise<void> => {
    if (!isAuthed()) return;
    if (naukriSyncInFlightRef.current) return;
    if (!force && Date.now() - lastNaukriSyncAtRef.current < NAUKRI_APPLY_SYNC_INTERVAL_MS) return;
    naukriSyncInFlightRef.current = true;
    try {
      const response = await applicationsAPI.syncNaukri();
      lastNaukriSyncAtRef.current = Date.now();
      if ((response.data?.updated || 0) > 0) {
        await refreshLiveData({ silent: true });
      }
    } catch {
      // Best-effort and read-only (e.g. Naukri not connected) — ignore failures.
    } finally {
      naukriSyncInFlightRef.current = false;
    }
  }, [refreshLiveData]);

  useEffect(() => {
    void syncNaukriApplied(true);
  }, [syncNaukriApplied]);

  const refreshPortalHealth = useCallback(async (_options: RefreshOptions = {}): Promise<PortalIssue[]> => {
    if (!isAuthed()) return [];
    if (portalSyncInFlightRef.current) return [];

    portalSyncInFlightRef.current = true;
    try {
      const response = await portalsAPI.getStatus();
      const issues = collectPortalIssues(response.data?.portals);
      setPortalIssues(issues);
      lastPortalHealthSyncAtRef.current = Date.now();
      return issues;
    } catch {
      return [];
    } finally {
      portalSyncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refreshPortalHealth();
  }, [location.key, refreshPortalHealth]);

  const runSafeAutoSync = useCallback(async () => {
    if (!isAuthed()) return;
    if (typeof document !== "undefined" && document.hidden) {
      setAutoSyncState("paused");
      return;
    }
    if (manualSearchLoading || activeApplyRef.current) {
      return;
    }

    setAutoSyncState("syncing");
    try {
      await refreshLiveData({ silent: true });
      if (Date.now() - lastPortalHealthSyncAtRef.current >= PORTAL_HEALTH_AUTO_SYNC_INTERVAL_MS) {
        await refreshPortalHealth({ silent: true });
      }
      await syncNaukriApplied();
    } finally {
      setAutoSyncState("idle");
    }
  }, [manualSearchLoading, refreshLiveData, refreshPortalHealth, syncNaukriApplied]);

  useEffect(() => {
    if (!isAuthed()) return undefined;

    const timer = window.setInterval(() => {
      void runSafeAutoSync();
    }, AUTO_SYNC_INTERVAL_MS);

    const syncWhenVisible = () => {
      if (document.hidden) {
        setAutoSyncState("paused");
        return;
      }
      void runSafeAutoSync();
    };

    const syncOnFocus = () => {
      void runSafeAutoSync();
    };

    document.addEventListener("visibilitychange", syncWhenVisible);
    window.addEventListener("focus", syncOnFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncWhenVisible);
      window.removeEventListener("focus", syncOnFocus);
    };
  }, [location.key, runSafeAutoSync]);

  const refreshAfterBackgroundApply = useCallback((pending: PendingApply) => {
    const delays = [1500, 4000, 8000, 15000];
    delays.forEach((delay, index) => {
      window.setTimeout(async () => {
        if (activeApplyRef.current !== pending.matchId) return;
        const snapshot = await refreshLiveData();
        if (!snapshot || activeApplyRef.current !== pending.matchId) return;

        const result = resolveApplyNotice(snapshot, pending);
        if (result) {
          activeApplyRef.current = null;
          setPendingApply(null);
          setApplyNotice(result);
          return;
        }

        if (index === delays.length - 1) {
          activeApplyRef.current = null;
          setPendingApply(null);
          setApplyNotice({
            tone: "info",
            title: "Still checking apply result",
            message: `${pending.title} at ${pending.company} was sent to the portal. Auto sync will update Tracker when the final status is visible.`,
            showTrackerAction: true,
          });
        }
      }, delay);
    });
  }, [refreshLiveData]);

  const runManualSearch = useCallback(
    async (query: string, options: ManualSearchOptions = {}) => {
      const trimmed = query.trim();
      const minScore = options.minScore ?? 60;
      setManualSearchLoading(true);
      setManualSearchQuery(trimmed);
      setManualSearchNotice(trimmed ? `Searching Naukri for "${trimmed}"...` : "Finding Naukri jobs from your saved profile...");
      setLiveError("");
      try {
        const response = await jobsAPI.search({
          query: trimmed,
          portals: ["naukri"],
          max_pages: 1,
          results_per_page: 20,
          locations: options.locations?.filter(Boolean),
          min_score: minScore,
          freshness_days: 30,
        });
        const run = response.data?.run;
        if (run) {
          const queryLabel = trimmed ? `"${run.query}"` : "your saved profile";
          const recommendedCount = Number(run.recommended_count ?? 0);
          setLastSearchSummary({
            query: String(run.query || trimmed),
            locations: Array.isArray(run.locations) ? run.locations : [],
            fetchedCount: Number(run.fetched_count || 0),
            savedCount: Number(run.saved_matches_count || 0),
            recommendedCount,
            minScore: Number(run.min_score || minScore),
          });
          setManualSearchNotice(
            `${run.saved_matches_count} resume-scored jobs saved from ${run.fetched_count} Naukri jobs for ${queryLabel}. ${recommendedCount} are recommended at score ${run.min_score}+.`
          );
        } else {
          setLastSearchSummary(null);
          setManualSearchNotice("Profile-based job fetch completed.");
        }
        // Search results are session-only: replace the review queue with this
        // search. They are never persisted or reloaded — a job is only stored when
        // the user opens its portal / applies.
        const searchMatches: JobMatch[] = (response.data?.matches || []).map(mapJobMatch);
        setJobs(searchMatches);
        setSearchResultIds(searchMatches.map((match) => match.id));
      } catch (caught) {
        setManualSearchNotice("");
        setLiveError(apiErrorMessage(caught, "Could not complete manual job search."));
      } finally {
        setManualSearchLoading(false);
      }
    },
    []
  );

  const metrics = useMemo(
    () => ({
      matches: jobs.length,
      approved: jobs.filter((job) => job.status === "pending" || job.status === "approved").length,
      applied: jobs.filter((job) => job.status === "applied").length + applications.filter((app) => app.status === "applied").length,
      blocked:
        jobs.filter((job) => job.status === "blocked" || job.status === "failed" || job.status === "needs_review" || job.status === "external_pending").length +
        applications.filter((app) => app.status === "blocked" || app.status === "failed" || app.status === "needs_review" || app.status === "external_pending").length,
    }),
    [applications, jobs]
  );

  const approveJob = async (id: string) => {
    setJobs((current) =>
      current.map((job) =>
        job.id === id
          ? { ...job, status: isExternalApplyJob(job) ? "external_pending" : "approved" }
          : job
      )
    );
    try {
      const response = await jobsAPI.approve(id);
      if (response.data?.status === "external_pending") {
        setJobs((current) =>
          current.map((job) =>
            job.id === id
              ? {
                  ...job,
                  status: "external_pending",
                  externalApplyUrl: response.data?.external_apply_url || job.externalApplyUrl,
                }
              : job
          )
        );
      }
      await refreshLiveData();
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not approve this job."));
      await refreshLiveData();
    }
  };

  const skipJob = async (id: string) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, status: "skipped" } : job)));
    try {
      await jobsAPI.skip(id);
      await refreshLiveData();
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not skip this job."));
      await refreshLiveData();
    }
  };

  const queueJob = async (id: string) => {
    if (activeApplyRef.current) return;
    const job = jobs.find((item) => item.id === id);
    if (!job || job.status === "skipped" || job.status === "applied") return;
    const originalStatus = job.status;
    const pending: PendingApply = {
      matchId: job.id,
      jobId: job.jobId || job.id,
      title: job.title,
      company: job.company,
      portal: job.portal,
    };
    activeApplyRef.current = job.id;
    setPendingApply(pending);
    setApplyNotice({
      tone: "info",
      title: "Opening portal",
      message: `Preparing ${job.title} at ${job.company} as a portal task. Finish the application on the original site, then confirm it in Tracker.`,
      showTrackerAction: true,
    });
    setLiveError("");
    setJobs((current) => current.map((item) => (item.id === id ? { ...item, status: "external_pending" } : item)));

    try {
      const response = job.persisted === false
        ? await jobsAPI.openPortalSnapshot(jobSnapshotPayload(job))
        : await jobsAPI.openPortal(id);
      const portalUrl = response.data?.external_apply_url || job.externalApplyUrl;
      if (portalUrl) {
        openExternalApply(portalUrl);
      }
      activeApplyRef.current = null;
      setPendingApply(null);
      setApplyNotice({
        tone: "warning",
        title: "Did you apply?",
        message: `${job.title} at ${job.company} opened on ${portalName(job.portal)}. When you're done there, confirm the result here.`,
        confirmable: true,
        applicationId: response.data?.application_id || "",
        matchId: job.id,
        jobId: job.jobId || job.id,
      });
      await refreshLiveData();
    } catch (caught) {
      const message = apiErrorMessage(caught, "Could not open the portal task.");
      activeApplyRef.current = null;
      setPendingApply(null);
      setApplyNotice({
        tone: "error",
        title: "Portal could not open",
        message,
        showTrackerAction: false,
      });
      setJobs((current) => current.map((item) => (item.id === id ? { ...item, status: originalStatus } : item)));
    }
  };

  const updateApplication = async (id: string, status: ApplicationStatus, notes?: string) => {
    setApplications((current) =>
      current.map((app) => (app.id === id ? { ...app, status, notes: notes ?? app.notes, latestDate: "Updating..." } : app))
    );
    try {
      await applicationsAPI.updateStatus(id, status, notes);
      await refreshLiveData();
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not update application status."));
      await refreshLiveData();
    }
  };

  // One-tap confirmation of a portal outcome straight from the Open-portal notice,
  // so the user never has to navigate to Tracker to mark Applied / Could not apply.
  const confirmPortalOutcome = async (status: ApplicationStatus) => {
    const notice = applyNotice;
    if (!notice?.confirmable) return;
    const sessionStatus = status === "applied" ? "applied" : "failed";
    if (notice.matchId) {
      setJobs((current) => current.map((item) => (item.id === notice.matchId ? { ...item, status: sessionStatus } : item)));
    }
    setApplyNotice({
      tone: status === "applied" ? "success" : "warning",
      title: status === "applied" ? "Marked as applied" : "Marked as not applied",
      message: status === "applied"
        ? "Saved to your Tracker as applied."
        : "Saved to your Tracker. You can reopen the portal and try again anytime.",
      showTrackerAction: true,
      action: "tracker",
      actionLabel: "Open tracker",
      trackerStatus: status,
    });
    const note = status === "applied"
      ? "User confirmed the application was completed on the portal."
      : "User could not complete the portal application.";
    try {
      let applicationId = notice.applicationId || "";
      if (!applicationId && notice.jobId) {
        const snapshot = await refreshLiveData();
        applicationId = snapshot?.applications.find((app) => app.jobId === notice.jobId)?.id || "";
      }
      if (applicationId) {
        await applicationsAPI.updateStatus(applicationId, status, note);
      }
      await refreshLiveData();
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not save the outcome. You can confirm it from Tracker."));
    }
  };

  const shellProps = {
    metrics,
    loading: loadingLiveData,
    error: liveError,
    searchLoading: manualSearchLoading,
    searchNotice: manualSearchNotice,
    searchQuery: manualSearchQuery,
    applyNotice,
    pendingApply,
    portalIssues,
    autoSyncState,
    lastAutoSyncedAt,
    onSearch: runManualSearch,
    onRetry: async () => {
      await Promise.all([refreshLiveData(), refreshPortalHealth()]);
    },
    onViewTracker: (status: ApplicationStatus = "applied") => navigate(`/tracker?status=${status}`),
    onReconnectPortal: (portal: string) => navigate(`/portals?connect=${portal}`),
    onConfirmOutcome: confirmPortalOutcome,
  };

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/login" element={<Navigate to="/auth" replace />} />
      <Route
        path="/onboarding"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Onboarding />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Dashboard jobs={jobs} applications={applications} onApprove={approveJob} onSkip={skipJob} onQueue={queueJob} onRefresh={refreshLiveData} applyingLocked={Boolean(pendingApply)} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Jobs jobs={jobs} onApprove={approveJob} onSkip={skipJob} onQueue={queueJob} onRefresh={refreshLiveData} onSearch={runManualSearch} searchLoading={manualSearchLoading} lastSearchSummary={lastSearchSummary} searchResultIds={searchResultIds} onClearSearchScope={() => setSearchResultIds(null)} applyingLocked={Boolean(pendingApply)} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/tracker"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Tracker applications={applications} onUpdate={updateApplication} onSyncApplied={() => syncNaukriApplied(true)} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/portals"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Portals />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Settings />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LiveShell({
  metrics,
  loading,
  error,
  searchLoading,
  searchNotice,
  searchQuery,
  applyNotice,
  pendingApply,
  portalIssues,
  autoSyncState,
  lastAutoSyncedAt,
  onSearch,
  onRetry,
  onViewTracker,
  onReconnectPortal,
  onConfirmOutcome,
  children,
}: {
  metrics: { matches: number; approved: number; applied: number; blocked: number };
  loading: boolean;
  error: string;
  searchLoading: boolean;
  searchNotice: string;
  searchQuery: string;
  applyNotice: ApplyNotice | null;
  pendingApply: PendingApply | null;
  portalIssues: PortalIssue[];
  autoSyncState: AutoSyncState;
  lastAutoSyncedAt: string;
  onSearch: (query: string, options?: ManualSearchOptions) => void | Promise<void>;
  onRetry: () => void | Promise<unknown>;
  onViewTracker: (status?: ApplicationStatus) => void;
  onReconnectPortal: (portal: string) => void;
  onConfirmOutcome: (status: ApplicationStatus) => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <AppShell
      metrics={metrics}
      portalIssues={portalIssues}
      onSync={onRetry}
      onSearch={onSearch}
      searchLoading={searchLoading}
      autoSyncState={autoSyncState}
      lastAutoSyncedAt={lastAutoSyncedAt}
    >
      {searchLoading && <SearchProgressBanner query={searchQuery} />}
      {portalIssues.length > 0 && <PortalReconnectBanner issue={portalIssues[0]} onReconnectPortal={onReconnectPortal} />}
      {applyNotice && <ApplyNoticeBanner notice={applyNotice} pendingApply={pendingApply} onViewTracker={onViewTracker} onReconnectPortal={onReconnectPortal} onConfirmOutcome={onConfirmOutcome} />}
      {!searchLoading && (searchNotice || loading || error) && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${error ? "border-[var(--state-error)] bg-white text-[var(--state-error)]" : "border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-muted)]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2">
              {!error && !loading && <CheckCircle size={16} style={{ color: "var(--state-success)" }} />}
              {error || (loading ? "Loading live Hunter data..." : searchNotice)}
            </span>
            {error && (
              <button type="button" onClick={() => void onRetry()} className="text-sm font-medium text-[var(--accent-primary)]">
                Retry
              </button>
            )}
          </div>
        </div>
      )}
      {children}
      {pendingApply && <ApplyBlockingOverlay pendingApply={pendingApply} />}
    </AppShell>
  );
}

function ApplyBlockingOverlay({ pendingApply }: { pendingApply: PendingApply }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 backdrop-blur-sm" role="alertdialog" aria-modal="true" aria-live="assertive">
      <section className="w-full max-w-md rounded-lg border border-[var(--accent-primary)] bg-[var(--bg-surface)] p-5 shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--accent-primary)]">
            <LoaderCircle size={22} className="animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[var(--text-primary)]">Opening {portalName(pendingApply.portal)}</p>
            <h2 className="mt-2 text-xl font-semibold leading-snug text-[var(--text-primary)]">{pendingApply.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{pendingApply.company}</p>
          </div>
        </div>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="hunter-search-progress h-full w-1/3 rounded-full bg-[var(--accent-primary)]" />
        </div>
        <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
          Hunter is creating a Tracker task and opening the original portal page. Complete the application there, then confirm the result here.
        </p>
      </section>
    </div>
  );
}

function ApplyNoticeBanner({
  notice,
  pendingApply,
  onViewTracker,
  onReconnectPortal,
  onConfirmOutcome,
}: {
  notice: ApplyNotice;
  pendingApply: PendingApply | null;
  onViewTracker: (status?: ApplicationStatus) => void;
  onReconnectPortal: (portal: string) => void;
  onConfirmOutcome: (status: ApplicationStatus) => void | Promise<void>;
}) {
  const toneStyle =
    notice.tone === "success"
      ? { borderColor: "var(--state-success)", iconColor: "var(--state-success)" }
      : notice.tone === "warning"
        ? { borderColor: "var(--state-warning)", iconColor: "var(--state-warning)" }
        : notice.tone === "error"
          ? { borderColor: "var(--state-error)", iconColor: "var(--state-error)" }
          : { borderColor: "var(--accent-primary)", iconColor: "var(--accent-primary)" };
  const Icon = notice.tone === "success" ? CheckCircle : notice.tone === "error" ? XCircle : notice.tone === "warning" ? AlertTriangle : Send;
  const hasAction = Boolean(notice.action || notice.showTrackerAction);
  const actionLabel = notice.actionLabel || (notice.action === "portal" ? "Reconnect portal" : "View applied");
  const runAction = () => {
    if (notice.action === "portal") {
      onReconnectPortal(notice.portalKey || "naukri");
      return;
    }
    onViewTracker(notice.trackerStatus);
  };

  return (
    <section className="mb-4 rounded-lg border bg-[var(--bg-surface)] px-4 py-3 text-sm shadow-sm" style={{ borderColor: toneStyle.borderColor }} aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)]" style={{ color: toneStyle.iconColor }}>
            {pendingApply ? <LoaderCircle size={17} className="animate-spin" /> : <Icon size={17} />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[var(--text-primary)]">{notice.title}</p>
            <p className="mt-1 text-[var(--text-muted)]">{notice.message}</p>
          </div>
        </div>
        {notice.confirmable ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={() => void onConfirmOutcome("applied")} className="air-button h-9 bg-[var(--state-success)] px-3 text-white">
              <CheckCircle size={15} />
              I applied
            </button>
            <button type="button" onClick={() => void onConfirmOutcome("failed")} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--state-error)] hover:border-[var(--state-error)]">
              <XCircle size={15} />
              Could not apply
            </button>
          </div>
        ) : hasAction && (
          <button type="button" onClick={runAction} className="air-button h-9 shrink-0 border border-[var(--border-default)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)]">
            {actionLabel}
            <ArrowRight size={14} />
          </button>
        )}
      </div>
    </section>
  );
}

function PortalReconnectBanner({
  issue,
  onReconnectPortal,
}: {
  issue: PortalIssue;
  onReconnectPortal: (portal: string) => void;
}) {
  return (
    <section className="mb-4 rounded-lg border border-[var(--state-warning)] bg-[var(--bg-surface)] px-4 py-3 text-sm shadow-sm" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--bg-elevated)] text-[var(--state-warning)]">
            <AlertTriangle size={17} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-[var(--text-primary)]">{issue.name} needs re-login</p>
            <p className="mt-1 text-[var(--text-muted)]">{issue.message}</p>
          </div>
        </div>
        <button type="button" onClick={() => onReconnectPortal(issue.portal)} className="air-button h-9 shrink-0 bg-[var(--accent-primary)] px-3 text-white hover:bg-[var(--accent-hover)]">
          Reconnect {issue.name}
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

function SearchProgressBanner({ query }: { query: string }) {
  const steps = ["Connect", "Fetch", "Score", "Save"];
  const sourceLabel = query ? `"${query}"` : "your saved profile";

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-[var(--accent-primary)] bg-[var(--bg-surface)] shadow-sm" aria-live="polite" aria-busy="true">
      <div className="relative h-1 bg-[var(--bg-elevated)]">
        <div className="hunter-search-progress absolute inset-y-0 left-0 w-1/3 rounded-full bg-[var(--accent-primary)]" />
      </div>
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent-primary)] text-white">
            <LoaderCircle size={18} className="animate-spin" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Finding live Naukri jobs</p>
            <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
              Fetching jobs from {sourceLabel}, scoring them against your resume, and saving curated matches to your review queue.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {steps.map((step, index) => (
            <div key={step} className="flex items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[var(--text-muted)]">
              {index === 2 ? <Sparkles size={12} className="animate-pulse text-[var(--accent-primary)]" /> : <Search size={12} className="text-[var(--accent-primary)]" />}
              <span>{step}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function resolveApplyNotice(snapshot: LiveDataSnapshot, pending: PendingApply): ApplyNotice | null {
  const application = snapshot.applications.find(
    (item) =>
      item.jobId === pending.jobId ||
      (
        item.portal.toLowerCase() === pending.portal.toLowerCase() &&
        item.title.toLowerCase() === pending.title.toLowerCase() &&
        item.company.toLowerCase() === pending.company.toLowerCase()
      )
  );
  if (application) {
    if (application.status === "applied") {
      return {
        tone: "success",
        title: "Applied successfully",
        message: `${application.title} at ${application.company} is saved in Tracker with the portal response.`,
        showTrackerAction: true,
      };
    }

    if (application.status === "external_pending") {
      return {
        tone: "warning",
        title: "Portal confirmation needed",
        message: `${application.title} at ${application.company} must be completed on the original portal. Open Tracker to continue and confirm the result.`,
        showTrackerAction: true,
        action: "tracker",
        actionLabel: "Open portal task",
        trackerStatus: "external_pending",
      };
    }

    if (application.status === "failed" || application.status === "blocked" || application.status === "needs_review") {
      const message = application.warning || application.applyResponse || `${application.title} at ${application.company} needs review before the portal task can be completed.`;
      const reconnect = needsPortalReconnect(message, application.portal);
      return {
        tone: application.status === "failed" ? "error" : "warning",
        title: reconnect ? `${portalName(application.portal)} needs re-login` : applyStatusTitle(application.status),
        message,
        showTrackerAction: !reconnect,
        action: reconnect ? "portal" : "tracker",
        actionLabel: reconnect ? `Reconnect ${portalName(application.portal)}` : "View applied",
        portalKey: application.portal,
      };
    }
  }

  const match = snapshot.jobs.find((item) => item.id === pending.matchId || item.jobId === pending.jobId);
  if (match?.status === "external_pending") {
    return {
      tone: "warning",
        title: "Portal confirmation needed",
        message: `${match.title} at ${match.company} must be completed on the original portal. Open Tracker to continue and confirm the result.`,
      showTrackerAction: true,
      action: "tracker",
      actionLabel: "Open portal task",
      trackerStatus: "external_pending",
    };
  }

  if (match?.status === "failed" || match?.status === "blocked" || match?.status === "needs_review") {
    return {
      tone: match.status === "failed" ? "error" : "warning",
      title: applyStatusTitle(match.status),
      message: match.note || `${match.title} at ${match.company} needs attention before the portal task can finish.`,
      showTrackerAction: true,
    };
  }

  return null;
}

function collectPortalIssues(value: unknown): PortalIssue[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, Record<string, unknown>>)
    .filter(([, row]) => Boolean(row?.requires_reconnect) || String(row?.connection_status || "").toLowerCase() === "expired")
    .map(([portal, row]) => ({
      portal,
      name: portalName(portal),
      message: text(row.status_message, `${portalName(portal)} session expired. Reconnect before using assisted portal actions.`),
      checked: text(row.last_checked_at || row.created_at),
    }));
}

function needsPortalReconnect(message: string, portal: string): boolean {
  const normalized = `${portal} ${message}`.toLowerCase();
  if (normalized.includes("naukri")) return false;
  return normalized.includes("session expired") || normalized.includes("reconnect");
}

function portalName(portal: string): string {
  const normalized = portal.toLowerCase();
  if (normalized === "naukri") return "Naukri";
  if (normalized === "foundit") return "Foundit";
  if (normalized === "linkedin") return "LinkedIn";
  return portal ? portal.charAt(0).toUpperCase() + portal.slice(1) : "Portal";
}

function applyStatusTitle(status: ApplicationStatus | JobMatch["status"]): string {
  if (status === "failed") return "Apply failed";
  if (status === "external_pending") return "Portal confirmation needed";
  if (status === "needs_review") return "Needs review";
  if (status === "blocked") return "Apply blocked";
  return "Apply status updated";
}

function jobSnapshotPayload(job: JobMatch) {
  return {
    job_id: job.jobId || job.id.replace(/^search:[^:]+:/, ""),
    title: job.title,
    company: job.company,
    location: job.location,
    experience: job.experience,
    salary: job.salary,
    posted_date: "",
    apply_link: job.externalApplyUrl || "",
    description: job.jdFullDescription || job.jdSummary,
    portal: job.portal,
    tags: job.matchedSkills,
    has_questionnaire: false,
    is_workday: job.portal.toLowerCase() === "workday",
    is_taleo: job.portal.toLowerCase() === "taleo",
    apply_method: job.applyMethod || "unknown",
    external_apply_url: job.externalApplyUrl || "",
    portal_metadata: { source: "manual_search_session" },
  };
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
