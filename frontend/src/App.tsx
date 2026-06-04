import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { Home } from "./pages/Home";
import { Auth } from "./pages/Auth";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { Jobs } from "./pages/Jobs";
import { Tracker } from "./pages/Tracker";
import { Portals } from "./pages/Portals";
import { Settings } from "./pages/Settings";
import { apiErrorMessage, applicationsAPI, jobsAPI } from "./api/client";
import { mapApplication, mapJobMatch } from "./api/mappers";
import type { Application, ApplicationStatus, JobMatch } from "./types";

function isAuthed() {
  return Boolean(localStorage.getItem("access_token"));
}

function PrivateRoute({ children }: { children: JSX.Element }) {
  const location = useLocation();
  return isAuthed() ? children : <Navigate to="/auth" replace state={{ from: location.pathname }} />;
}

export default function App() {
  const [jobs, setJobs] = useState<JobMatch[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingLiveData, setLoadingLiveData] = useState(false);
  const [liveError, setLiveError] = useState("");

  const refreshLiveData = useCallback(async () => {
    if (!isAuthed()) return;
    setLoadingLiveData(true);
    setLiveError("");
    try {
      const [matchesResponse, applicationsResponse] = await Promise.all([
        jobsAPI.getMatches(),
        applicationsAPI.getAll(),
      ]);
      setJobs((matchesResponse.data?.matches || []).map(mapJobMatch));
      setApplications((applicationsResponse.data?.applications || []).map(mapApplication));
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not load live Hunter data."));
    } finally {
      setLoadingLiveData(false);
    }
  }, []);

  useEffect(() => {
    void refreshLiveData();
  }, [refreshLiveData]);

  const metrics = useMemo(
    () => ({
      matches: jobs.length,
      approved: jobs.filter((job) => job.status === "approved" || job.status === "applying" || job.status === "queued").length,
      applied: jobs.filter((job) => job.status === "applied").length + applications.filter((app) => app.status === "applied").length,
      blocked:
        jobs.filter((job) => job.status === "blocked" || job.status === "failed" || job.status === "needs_review").length +
        applications.filter((app) => app.status === "blocked" || app.status === "failed" || app.status === "needs_review").length,
    }),
    [applications, jobs]
  );

  const approveJob = async (id: string) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, status: "approved" } : job)));
    try {
      await jobsAPI.approve(id);
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
    const job = jobs.find((item) => item.id === id);
    if (!job || job.status !== "approved") return;
    setJobs((current) => current.map((item) => (item.id === id ? { ...item, status: "applying" } : item)));
    try {
      await jobsAPI.apply(id);
      window.setTimeout(() => {
        void refreshLiveData();
      }, 1500);
    } catch (caught) {
      setLiveError(apiErrorMessage(caught, "Could not start Apply now."));
      setJobs((current) => current.map((item) => (item.id === id ? { ...item, status: "approved" } : item)));
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

  const shellProps = {
    metrics,
    loading: loadingLiveData,
    error: liveError,
    onRetry: refreshLiveData,
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
              <Dashboard jobs={jobs} applications={applications} onApprove={approveJob} onSkip={skipJob} onQueue={queueJob} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Jobs jobs={jobs} onApprove={approveJob} onSkip={skipJob} onQueue={queueJob} />
            </LiveShell>
          </PrivateRoute>
        }
      />
      <Route
        path="/tracker"
        element={
          <PrivateRoute>
            <LiveShell {...shellProps}>
              <Tracker applications={applications} onUpdate={updateApplication} />
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
  onRetry,
  children,
}: {
  metrics: { matches: number; approved: number; applied: number; blocked: number };
  loading: boolean;
  error: string;
  onRetry: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <AppShell metrics={metrics}>
      {(loading || error) && (
        <div className="mb-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 text-sm text-[var(--text-muted)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{loading ? "Loading live Hunter data..." : error}</span>
            {error && (
              <button type="button" onClick={() => void onRetry()} className="text-sm font-medium text-[var(--accent-primary)]">
                Retry
              </button>
            )}
          </div>
        </div>
      )}
      {children}
    </AppShell>
  );
}
