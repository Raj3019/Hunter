import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle, Send, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageLoadingOverlay } from "@/components/ui/page-loading-overlay";
import { Spinner } from "@/components/ui/spinner";
import { AppShell } from "./components/AppShell";
import { PageLoadingContext, type PageLoadingState } from "./components/PageLoadingContext";
import { useToast } from "./components/Toast";
import { Home } from "./pages/Home";
import { Auth } from "./pages/Auth";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Jobs } from "./pages/Jobs";
import { Tracker } from "./pages/Tracker";
import { Portals } from "./pages/Portals";
import { Settings } from "./pages/Settings";
import { apiErrorMessage, applicationsAPI, authAPI, jobsAPI, portalsAPI, preferencesAPI, CAREER_PORTAL_KEYS } from "./api/client";

// Single source for the recommend cutoff fallback (used only until the saved
// preference loads / when none is set). The real value comes from Settings.
const DEFAULT_RECOMMEND_THRESHOLD = 60;
import { mapApplication, mapJobMatch } from "./api/mappers";
import { setCurrentUserProfile } from "./lib/session";
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
type UserProfile = {
  name: string;
  email: string;
};

const AUTO_SYNC_INTERVAL_MS = 60_000;
const PORTAL_HEALTH_AUTO_SYNC_INTERVAL_MS = 10 * 60_000;
const APPLY_SYNC_INTERVAL_MS = 5 * 60_000;
const AUTO_PROFILE_SEARCH_EXCLUDED_PATHS = new Set(["/", "/auth", "/login", "/onboarding"]);

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [recommendThreshold, setRecommendThreshold] = useState(DEFAULT_RECOMMEND_THRESHOLD);
  const [loadingLiveData, setLoadingLiveData] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [manualSearchLoading, setManualSearchLoading] = useState(false);
  const [manualSearchNotice, setManualSearchNotice] = useState("");
  const [manualSearchQuery, setManualSearchQuery] = useState("");
  const [lastSearchSummary, setLastSearchSummary] = useState<SearchRunSummary | null>(null);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const searchPageRef = useRef(1);
  const lastSearchRef = useRef<{ query: string; locations?: string[] }>({ query: "" });

  // Auto-dismiss the search-result strip after a few seconds, consistent with the
  // toast/alert system; the Jobs list keeps showing the full loaded match set.
  useEffect(() => {
    if (manualSearchLoading || !manualSearchNotice) return;
    const timer = window.setTimeout(() => setManualSearchNotice(""), 6000);
    return () => window.clearTimeout(timer);
  }, [manualSearchNotice, manualSearchLoading]);
  const [applyNotice, setApplyNotice] = useState<ApplyNotice | null>(null);
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [portalIssues, setPortalIssues] = useState<PortalIssue[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile>({ name: "", email: "" });
  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState>("idle");
  const [lastAutoSyncedAt, setLastAutoSyncedAt] = useState("");
  const activeApplyRef = useRef<string | null>(null);
  const liveSyncInFlightRef = useRef(false);
  const portalSyncInFlightRef = useRef(false);
  const lastPortalHealthSyncAtRef = useRef(0);
  const jobsRef = useRef<JobMatch[]>([]);
  const lastAppliedSyncAtRef = useRef(0);
  const appliedSyncInFlightRef = useRef(false);
  const autoProfileSearchTokenRef = useRef<string | null>(null);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const refreshUserProfile = useCallback(async (): Promise<UserProfile | undefined> => {
    if (!isAuthed()) {
      setUserProfile({ name: "", email: "" });
      return undefined;
    }
    try {
      const response = await authAPI.me();
      const next = {
        name: text(response.data?.full_name),
        email: text(response.data?.email),
      };
      setCurrentUserProfile({
        userId: text(response.data?.user_id),
        email: next.email,
        fullName: next.name,
      });
      setUserProfile(next);
      return next;
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    void refreshUserProfile();
  }, [location.key, refreshUserProfile]);

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

  // Read-only: ask each connected portal which jobs the user has applied to and
  // auto-advance matching portal-pending tasks. Throttled; safe to call often.
  const syncAppliedStatus = useCallback(async (force = false): Promise<void> => {
    if (!isAuthed()) return;
    if (appliedSyncInFlightRef.current) return;
    if (!force && Date.now() - lastAppliedSyncAtRef.current < APPLY_SYNC_INTERVAL_MS) return;
    appliedSyncInFlightRef.current = true;
    try {
      // Each sync is independent and read-only — one portal failing (e.g. not
      // connected) must not block the others.
      const results = await Promise.allSettled([
        applicationsAPI.syncNaukri(),
        applicationsAPI.syncFoundit(),
        ...CAREER_PORTAL_KEYS.map((key) => applicationsAPI.syncCareer(key)),
      ]);
      lastAppliedSyncAtRef.current = Date.now();
      // Count both advanced ("updated") and newly imported career-portal applies.
      const changedCount = results.reduce(
        (sum, r) =>
          sum +
          (r.status === "fulfilled"
            ? (r.value.data?.updated || 0) + (r.value.data?.imported || 0)
            : 0),
        0,
      );
      if (changedCount > 0) {
        // Auto-detected the apply: confirm it with a toast and clear any pending
        // "Did you apply?" prompt, so the user never has to confirm manually.
        setApplyNotice(null);
        toast.success(
          changedCount === 1
            ? "Application synced from your portal ✓"
            : `${changedCount} applications synced from your portals ✓`,
        );
        await refreshLiveData({ silent: true });
      }
    } catch {
      // Best-effort and read-only — ignore failures.
    } finally {
      appliedSyncInFlightRef.current = false;
    }
  }, [refreshLiveData, toast]);

  useEffect(() => {
    void syncAppliedStatus(true);
  }, [syncAppliedStatus]);

  // Load the user's "recommend at least %" threshold once (drives the Dashboard
  // Shortlists count and the Jobs "Recommended" label — no hardcoded cutoff).
  useEffect(() => {
    if (!isAuthed()) return;
    preferencesAPI
      .get()
      .then((res) => {
        const value = Number(res.data?.auto_apply_min_score);
        if (Number.isFinite(value) && value > 0) setRecommendThreshold(value);
      })
      .catch(() => {});
  }, [location.key]);

  // Always force a fresh applied-status sync when the user opens the Tracker, so
  // statuses update on their own without needing the manual refresh button.
  useEffect(() => {
    if (location.pathname === "/tracker") void syncAppliedStatus(true);
  }, [location.pathname, syncAppliedStatus]);

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
      await syncAppliedStatus();
    } finally {
      setAutoSyncState("idle");
    }
  }, [manualSearchLoading, refreshLiveData, refreshPortalHealth, syncAppliedStatus]);

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
      // Returning to the tab is exactly when the user is back from applying —
      // force the applied-status sync (bypassing the throttle) so it confirms fast.
      void runSafeAutoSync();
      void syncAppliedStatus(true);
    };

    const syncOnFocus = () => {
      void runSafeAutoSync();
      void syncAppliedStatus(true);
    };

    document.addEventListener("visibilitychange", syncWhenVisible);
    window.addEventListener("focus", syncOnFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncWhenVisible);
      window.removeEventListener("focus", syncOnFocus);
    };
  }, [location.key, runSafeAutoSync, syncAppliedStatus]);

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

  const fetchSearchPage = (query: string, locations: string[] | undefined, page: number) =>
    jobsAPI.search({
      query,
      portals: ["naukri", "foundit", "internshala"],
      page,
      results_per_page: 20,
      locations,
      min_score: 0,
      freshness_days: 30,
    });

  const runManualSearch = useCallback(
    async (query: string, options: ManualSearchOptions = {}) => {
      const trimmed = query.trim();
      const locations = options.locations?.filter(Boolean);
      setManualSearchLoading(true);
      setManualSearchQuery(trimmed);
      setManualSearchNotice(trimmed ? `Searching Naukri + Foundit for "${trimmed}"...` : "Finding jobs from your saved profile...");
      setLiveError("");
      searchPageRef.current = 1;
      lastSearchRef.current = { query: trimmed, locations };
      try {
        const response = await fetchSearchPage(trimmed, locations, 1);
        const run = response.data?.run;
        setSearchHasMore(Boolean(run?.has_more));
        if (run) {
          const queryLabel = trimmed ? `"${run.query}"` : "your saved profile";
          setLastSearchSummary({
            query: String(run.query || trimmed),
            locations: Array.isArray(run.locations) ? run.locations : [],
            fetchedCount: Number(run.fetched_count || 0),
            savedCount: Number(run.saved_matches_count || 0),
            recommendedCount: Number(run.recommended_count ?? 0),
            minScore: Number(run.min_score || 0),
          });
          const counts = (run.portal_counts || {}) as Record<string, number>;
          const breakdown = Object.entries(counts).map(([portal, n]) => `${portalName(portal)} ${n}`).join(" · ");
          setManualSearchNotice(
            `${run.saved_matches_count} jobs found for ${queryLabel}, scored against your resume${breakdown ? ` — ${breakdown}` : ""}. Use "Load more" for additional pages.`
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
      } catch (caught) {
        setManualSearchNotice("");
        setLiveError(apiErrorMessage(caught, "Could not complete manual job search."));
      } finally {
        setManualSearchLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      autoProfileSearchTokenRef.current = null;
      return;
    }
    if (AUTO_PROFILE_SEARCH_EXCLUDED_PATHS.has(location.pathname)) return;
    if (autoProfileSearchTokenRef.current === token) return;
    if (manualSearchLoading) return;

    if (jobsRef.current.length > 0 || lastSearchSummary) {
      autoProfileSearchTokenRef.current = token;
      return;
    }

    autoProfileSearchTokenRef.current = token;
    void runManualSearch("");
  }, [lastSearchSummary, location.pathname, manualSearchLoading, runManualSearch]);

  const loadMoreResults = useCallback(async () => {
    if (searchLoadingMore || !searchHasMore) return;
    const { query, locations } = lastSearchRef.current;
    setSearchLoadingMore(true);
    try {
      const newJobs: JobMatch[] = [];
      const seen = new Set(jobsRef.current.map((job) => job.id));
      let backendHasMore = true;
      let attempts = 0;
      // Skip pages that only return duplicates so one click reliably adds jobs;
      // stop as soon as we find new jobs or the portals are exhausted.
      while (backendHasMore && attempts < 5 && newJobs.length === 0) {
        attempts += 1;
        searchPageRef.current += 1;
        const response = await fetchSearchPage(query, locations, searchPageRef.current);
        backendHasMore = Boolean(response.data?.run?.has_more);
        const fetched: JobMatch[] = (response.data?.matches || []).map(mapJobMatch);
        for (const job of fetched) {
          if (!seen.has(job.id)) {
            seen.add(job.id);
            newJobs.push(job);
          }
        }
      }
      if (newJobs.length) {
        setJobs((current) => [...current, ...newJobs]);
      }
      // Hide "Load more" once there are no further jobs to fetch.
      setSearchHasMore(backendHasMore && newJobs.length > 0);
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not load more results."));
    } finally {
      setSearchLoadingMore(false);
    }
  }, [searchHasMore, searchLoadingMore]);

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
    userProfile,
    onSearch: runManualSearch,
    onDismissSearchNotice: () => setManualSearchNotice(""),
    onRetry: async () => {
      await Promise.all([refreshUserProfile(), refreshLiveData(), refreshPortalHealth()]);
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
              <Dashboard jobs={jobs} applications={applications} onApprove={approveJob} onSkip={skipJob} onQueue={queueJob} onRefresh={refreshLiveData} applyingLocked={Boolean(pendingApply)} recommendThreshold={recommendThreshold} userName={userProfile.name} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Jobs jobs={jobs} onApprove={approveJob} onSkip={skipJob} onQueue={queueJob} onRefresh={refreshLiveData} onSearch={runManualSearch} searchLoading={manualSearchLoading} lastSearchSummary={lastSearchSummary} onLoadMore={loadMoreResults} hasMore={searchHasMore} loadingMore={searchLoadingMore} applyingLocked={Boolean(pendingApply)} recommendThreshold={recommendThreshold} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/tracker"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Tracker applications={applications} onUpdate={updateApplication} onSyncApplied={() => syncAppliedStatus(true)} />
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
              <Settings userProfile={userProfile} onProfileSaved={refreshUserProfile} />
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
  userProfile,
  onSearch,
  onDismissSearchNotice,
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
  userProfile: UserProfile;
  onSearch: (query: string, options?: ManualSearchOptions) => void | Promise<void>;
  onDismissSearchNotice: () => void;
  onRetry: () => void | Promise<unknown>;
  onViewTracker: (status?: ApplicationStatus) => void;
  onReconnectPortal: (portal: string) => void;
  onConfirmOutcome: (status: ApplicationStatus) => void | Promise<void>;
  children: ReactNode;
}) {
  const [pageLoading, setPageLoading] = useState<PageLoadingState | null>(null);
  const blockingOverlay = searchLoading
    ? {
        title: "Finding live jobs...",
        description: `Fetching jobs from ${searchQuery ? `"${searchQuery}"` : "your saved profile"}, scoring them against your resume, and saving curated matches.`,
      }
    : loading
      ? {
          title: "Loading Hunter data...",
          description: "Refreshing your saved matches, applications, and portal status.",
        }
      : null;
  const loadingOverlay = blockingOverlay || pageLoading;

  return (
    <AppShell
      metrics={metrics}
      portalIssues={portalIssues}
      onSync={onRetry}
      onSearch={onSearch}
      searchLoading={searchLoading}
      autoSyncState={autoSyncState}
      lastAutoSyncedAt={lastAutoSyncedAt}
      userProfile={userProfile}
    >
      <PageLoadingContext.Provider value={setPageLoading}>
        {!blockingOverlay && portalIssues.length > 0 && <PortalReconnectBanner issue={portalIssues[0]} onReconnectPortal={onReconnectPortal} />}
        {!blockingOverlay && applyNotice && <ApplyNoticeBanner notice={applyNotice} pendingApply={pendingApply} onViewTracker={onViewTracker} onReconnectPortal={onReconnectPortal} onConfirmOutcome={onConfirmOutcome} />}
        {!blockingOverlay && !searchLoading && (searchNotice || error) && (
          <Alert
            variant={error ? "destructive" : "success"}
            aria-live="polite"
            className="mb-4"
            onClose={!error && searchNotice ? onDismissSearchNotice : undefined}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <AlertTitle>{error ? "Hunter could not finish that request" : "Search complete"}</AlertTitle>
                <AlertDescription>{error || searchNotice}</AlertDescription>
              </div>
              {error && (
                <button type="button" onClick={() => void onRetry()} className="font-semibold underline-offset-2 hover:underline">
                  Retry
                </button>
              )}
            </div>
          </Alert>
        )}
        {!blockingOverlay && children}
      </PageLoadingContext.Provider>
      {loadingOverlay && <PageLoadingOverlay title={loadingOverlay.title} description={loadingOverlay.description} />}
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
            <Spinner className="size-[22px]" />
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
  const Icon = notice.tone === "success" ? CheckCircle : notice.tone === "error" ? XCircle : notice.tone === "warning" ? AlertTriangle : Send;
  const variant = notice.tone === "success" ? "success" : notice.tone === "warning" ? "warning" : notice.tone === "error" ? "destructive" : "info";
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
    <Alert variant={variant} icon={pendingApply ? <Spinner /> : <Icon />} className="mb-4 rounded-lg shadow-sm" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold">{notice.title}</p>
          <p className="mt-1 opacity-90">{notice.message}</p>
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
    </Alert>
  );
}

function PortalReconnectBanner({
  issue,
  onReconnectPortal,
}: {
  issue: PortalIssue;
  onReconnectPortal: (portal: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [issue.portal]);
  if (dismissed) return null;
  return (
    <Alert
      variant="warning"
      icon={<AlertTriangle />}
      className="mb-4 shadow-sm"
      aria-live="polite"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
          <Button variant="default" size="sm" onClick={() => onReconnectPortal(issue.portal)}>
            Reconnect
            <ArrowRight />
          </Button>
        </>
      }
    >
      <AlertTitle>{issue.name} sign-in expired</AlertTitle>
      <AlertDescription>{issue.message}</AlertDescription>
    </Alert>
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
        title: "Awaiting confirmation",
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
        title: "Awaiting confirmation",
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
  return portal ? portal.charAt(0).toUpperCase() + portal.slice(1) : "Portal";
}

function applyStatusTitle(status: ApplicationStatus | JobMatch["status"]): string {
  if (status === "failed") return "Apply failed";
  if (status === "external_pending") return "Awaiting confirmation";
  if (status === "needs_review") return "Needs review";
  if (status === "blocked") return "Apply blocked";
  return "Apply status updated";
}

function jobSnapshotPayload(job: JobMatch) {
  return {
    job_id: job.jobId || job.id.replace(/^search:[^:]+:/, ""),
    score: job.score || 0,
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
    portal_metadata: { source: "manual_search_session", company_logo_url: job.companyLogoUrl || "" },
  };
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
