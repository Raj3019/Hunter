import { AlertTriangle, ArrowRight, CheckCircle, Clock, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StateSurface } from "../components/StateSurface";
import { StatusPill } from "../components/StatusPill";
import { TailorModal } from "../components/TailorModal";
import { portalsAPI } from "../api/client";
import type { Application, JobMatch } from "../types";
import { isExternalApplyJob, openExternalApply } from "../utils/jobApply";

type PortalHealthRow = { key: string; name: string; label: string; tone: "success" | "warning" | "neutral" };

const PORTAL_LABELS: Record<string, string> = { naukri: "Naukri", foundit: "Foundit", linkedin: "LinkedIn", internshala: "Internshala", workday: "Workday", taleo: "Taleo" };

function portalLabel(key: string): string {
  return PORTAL_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Portal");
}

function toPortalHealth(portals: Record<string, Record<string, unknown>>): PortalHealthRow[] {
  return Object.entries(portals).map(([key, row]) => {
    const expired = Boolean(row.requires_reconnect) || String(row.connection_status || "") === "expired";
    return {
      key,
      name: portalLabel(key),
      label: expired ? "Reconnect" : "Connected",
      tone: expired ? "warning" : "success",
    };
  });
}

interface DashboardProps {
  jobs: JobMatch[];
  applications: Application[];
  onApprove?: (id: string) => void;
  onSkip: (id: string) => void;
  onQueue: (id: string) => void;
  onRefresh: () => void | Promise<unknown>;
  applyingLocked?: boolean;
}

function scoreColor(score: number) {
  if (score >= 80) return "var(--score-high)";
  if (score >= 60) return "var(--score-mid)";
  return "var(--score-low)";
}

export function Dashboard({ jobs, applications, onSkip, onQueue, onRefresh, applyingLocked = false }: DashboardProps) {
  const [tailorJob, setTailorJob] = useState<JobMatch | null>(null);
  const [portalHealth, setPortalHealth] = useState<PortalHealthRow[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    portalsAPI
      .getStatus()
      .then((response) => {
        if (cancelled) return;
        setPortalHealth(toPortalHealth(response.data?.portals || {}));
      })
      .catch(() => {
        if (!cancelled) setPortalHealth([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connectedPortals = portalHealth.filter((row) => row.tone === "success").length;
  const reconnectPortals = portalHealth.filter((row) => row.tone === "warning");
  const nextJob = jobs.find((job) => job.status === "pending") || jobs.find((job) => job.status === "approved") || jobs.find((job) => job.status === "external_pending") || jobs[0];
  const nextJobExternal = nextJob ? isExternalApplyJob(nextJob) : false;

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label={`${jobs.length} matches`} tone="accent" />
            <StatusPill label={connectedPortals > 0 ? `${connectedPortals} portal${connectedPortals === 1 ? "" : "s"} connected` : "No portals connected"} tone={connectedPortals > 0 ? "success" : "neutral"} />
            {reconnectPortals.length > 0 && <StatusPill label={`${reconnectPortals.length} need reconnect`} tone="warning" />}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Review curated matches, open the original portal, and confirm outcomes when you finish applying.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
          {[
            ["Matches", jobs.length],
            ["Ready", jobs.filter((job) => job.status === "pending" || job.status === "approved").length],
            ["Portal pending", jobs.filter((job) => job.status === "external_pending").length + applications.filter((app) => app.status === "external_pending").length],
          ].map(([label, value]) => (
            <div key={label} className="min-w-24 px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">{label}</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {nextJob ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <section className="air-surface rounded-lg p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--text-muted)]">Next best action</p>
                <h2 className="mt-2 text-xl font-semibold">{nextJob.title}</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{nextJob.company} - {nextJob.portal} - {nextJob.location}</p>
              </div>
              <div className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border bg-[var(--bg-surface)]" style={{ color: scoreColor(nextJob.score), borderColor: scoreColor(nextJob.score) }}>
                <span className="text-3xl font-semibold leading-none">{nextJob.score}</span>
                <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide">match</span>
              </div>
            </div>

            <p className="mt-5 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">{nextJob.jdSummary}</p>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Matched skills</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {nextJob.matchedSkills.map((skill) => (
                    <span key={skill} className="rounded px-2 py-1 text-xs" style={{ color: "var(--state-success)", background: "color-mix(in srgb, var(--state-success) 12%, transparent)" }}>
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Missing skills</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {nextJob.missingSkills.map((skill) => (
                    <span key={skill} className="rounded bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-muted)]">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-default)] pt-4">
              <p className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <ShieldCheck size={16} style={{ color: "var(--state-success)" }} />
                {nextJob.tailoredResumeApproved ? "Tailored resume ready." : "Base resume ready."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setTailorJob(nextJob)} disabled={nextJob.persisted === false} className="air-button h-10 border border-[var(--border-default)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50" title={nextJob.persisted === false ? "Tailoring is available after a job is saved to the review queue." : "Tailor resume"}>
                  <FileText size={15} />
                  Tailor
                </button>
                {nextJob.status === "external_pending" ? (
                  <button type="button" onClick={() => openExternalApply(nextJob.externalApplyUrl || "")} disabled={!nextJob.externalApplyUrl} className="air-button h-10 bg-[var(--state-warning)] px-4 text-white disabled:cursor-not-allowed disabled:opacity-50">
                    <ExternalLink size={15} />
                    Open portal
                  </button>
                ) : nextJob.status === "pending" || nextJob.status === "approved" || nextJob.status === "applying" || nextJobExternal ? (
                  <button type="button" onClick={() => onQueue(nextJob.id)} disabled={nextJob.status === "applying" || applyingLocked} className="air-button h-10 bg-[var(--state-success)] px-4 text-white disabled:cursor-not-allowed disabled:opacity-80">
                    {nextJob.status === "applying" || applyingLocked ? "Opening" : "Open portal"}
                  </button>
                ) : (
                  <button type="button" disabled className="air-button h-10 bg-[var(--accent-primary)] px-4 text-white disabled:cursor-not-allowed disabled:opacity-70">
                    Ready
                  </button>
                )}
                {nextJob.status !== "approved" && (
                  <button type="button" onClick={() => onSkip(nextJob.id)} className="air-button h-10 border border-[var(--border-default)] px-3 text-[var(--text-muted)] hover:text-[var(--state-error)]">
                    Skip
                  </button>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="air-surface rounded-lg p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck size={17} style={{ color: "var(--state-success)" }} />
                Portal workflow
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Submission</dt><dd>User-led</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Portal</dt><dd>Source of truth</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Tracker</dt><dd>Confirm result</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Auto-submit</dt><dd>Dormant</dd></div>
              </dl>
            </section>

            <section className="air-surface rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Portal health</h2>
                <button type="button" onClick={() => navigate("/portals")} className="text-xs font-medium text-[var(--accent-primary)]">Manage</button>
              </div>
              <div className="mt-4 space-y-3 text-sm">
                {portalHealth.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">No portals connected yet. Connect one from Portals.</p>
                ) : (
                  portalHealth.map((row) => (
                    <div key={row.key} className="flex items-center justify-between gap-3">
                      <span>{row.name}</span>
                      <StatusPill label={row.label} tone={row.tone} />
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>

          <section className="air-surface rounded-lg p-4 xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Pipeline preview</h2>
              <button type="button" onClick={() => navigate("/tracker")} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-primary)]">
                Open tracker
                <ArrowRight size={14} />
              </button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {[
                ["Needs review", applications.filter((app) => app.status === "needs_review" || app.status === "blocked").length],
                ["Portal pending", applications.filter((app) => app.status === "external_pending").length],
                ["Approved", applications.filter((app) => app.status === "approved").length],
                ["Applied", applications.filter((app) => app.status === "applied").length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
                  <p className="text-xs text-[var(--text-muted)]">{label}</p>
                  <p className="mt-2 text-xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <StateSurface icon={Clock} title="No matches ready" body="Auto sync keeps saved matches fresh. Use Jobs search when you want Hunter to fetch new roles." primary="Refresh now" secondary="Open settings" />
      )}

      <section className="mt-5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2"><CheckCircle size={15} style={{ color: "var(--state-success)" }} /> {jobs.length} matches in review</span>
          <span className="inline-flex items-center gap-2"><CheckCircle size={15} style={{ color: "var(--state-success)" }} /> {connectedPortals} portal{connectedPortals === 1 ? "" : "s"} connected</span>
          {reconnectPortals.map((row) => (
            <span key={row.key} className="inline-flex items-center gap-2"><AlertTriangle size={15} style={{ color: "var(--state-warning)" }} /> {row.name} reconnect needed</span>
          ))}
        </div>
      </section>

      {tailorJob && <TailorModal job={tailorJob} onClose={() => setTailorJob(null)} onApproved={onRefresh} />}
    </>
  );
}
