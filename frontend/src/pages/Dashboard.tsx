import { AlertTriangle, ArrowRight, CheckCircle, Clock, FileText, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { StateSurface } from "../components/StateSurface";
import { StatusPill } from "../components/StatusPill";
import { TailorModal } from "../components/TailorModal";
import type { Application, JobMatch } from "../types";

interface DashboardProps {
  jobs: JobMatch[];
  applications: Application[];
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onQueue: (id: string) => void;
}

function scoreColor(score: number) {
  if (score >= 80) return "var(--score-high)";
  if (score >= 60) return "var(--score-mid)";
  return "var(--score-low)";
}

export function Dashboard({ jobs, applications, onApprove, onSkip, onQueue }: DashboardProps) {
  const [tailorJob, setTailorJob] = useState<JobMatch | null>(null);
  const navigate = useNavigate();
  const nextJob = jobs.find((job) => job.status === "pending") || jobs.find((job) => job.status === "approved") || jobs[0];

  return (
    <>
      <section className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label="Resume parsed" tone="success" />
            <StatusPill label="Preferences saved" tone="success" />
            <StatusPill label="Portals connected" tone="accent" />
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">Today</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Review only what needs action. Hunter keeps the rest of the automation quiet until your approval is needed.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
          {[
            ["Matches", jobs.length],
            ["Ready", jobs.filter((job) => job.status === "approved" || job.status === "applying").length],
            ["Blocked", jobs.filter((job) => job.status === "blocked" || job.status === "failed" || job.status === "needs_review").length + applications.filter((app) => app.warning).length],
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
                Safety checks run instantly when you apply.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setTailorJob(nextJob)} className="air-button h-10 border border-[var(--border-default)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)]">
                  <FileText size={15} />
                  Tailor
                </button>
                {nextJob.status === "approved" || nextJob.status === "applying" ? (
                  <button type="button" onClick={() => onQueue(nextJob.id)} disabled={nextJob.status === "applying"} className="air-button h-10 bg-[var(--state-success)] px-4 text-white disabled:cursor-not-allowed disabled:opacity-80">
                    {nextJob.status === "applying" ? "Applying" : "Apply now"}
                  </button>
                ) : (
                  <button type="button" onClick={() => onApprove(nextJob.id)} className="air-button h-10 bg-[var(--accent-primary)] px-4 text-white hover:bg-[var(--accent-hover)]">
                    Approve
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
                Apply safety
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Window</dt><dd>9am-8pm IST</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Daily limit</dt><dd>12 applies</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Cooldown</dt><dd>90 sec avg</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[var(--text-muted)]">Before apply</dt><dd>Quick check</dd></div>
              </dl>
            </section>

            <section className="air-surface rounded-lg p-4">
              <h2 className="text-sm font-semibold">Portal health</h2>
              <div className="mt-4 space-y-3 text-sm">
                {[
                  ["Naukri", "Connected", "success"],
                  ["Foundit", "Expired", "warning"],
                  ["LinkedIn", "Ready", "success"],
                ].map(([name, status, tone]) => (
                  <div key={name} className="flex items-center justify-between gap-3">
                    <span>{name}</span>
                    <StatusPill label={status} tone={tone as "success" | "warning"} />
                  </div>
                ))}
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
                ["Approved", applications.filter((app) => app.status === "approved").length],
                ["Applied", applications.filter((app) => app.status === "applied").length],
                ["Interview", applications.filter((app) => app.status === "interview").length],
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
        <StateSurface icon={Clock} title="No matches ready" body="The scheduler has not produced scored matches yet." primary="Run sync" secondary="Open settings" />
      )}

      <section className="mt-5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2"><CheckCircle size={15} style={{ color: "var(--state-success)" }} /> Resume parsed</span>
          <span className="inline-flex items-center gap-2"><CheckCircle size={15} style={{ color: "var(--state-success)" }} /> Preferences saved</span>
          <span className="inline-flex items-center gap-2"><AlertTriangle size={15} style={{ color: "var(--state-warning)" }} /> Foundit reconnect needed</span>
        </div>
      </section>

      {tailorJob && <TailorModal job={tailorJob} onClose={() => setTailorJob(null)} />}
    </>
  );
}
