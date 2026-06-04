import { AlertTriangle, Brain, CheckCircle, FileText, MoreHorizontal, Send, ShieldCheck, SlidersHorizontal, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusPill } from "../components/StatusPill";
import { TailorModal } from "../components/TailorModal";
import type { JobMatch } from "../types";

interface JobsProps {
  jobs: JobMatch[];
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onQueue: (id: string) => void;
}

function scoreColor(score: number) {
  if (score >= 80) return "var(--score-high)";
  if (score >= 60) return "var(--score-mid)";
  return "var(--score-low)";
}

function statusTone(status: JobMatch["status"]) {
  if (status === "approved" || status === "queued" || status === "applying" || status === "applied") return "success";
  if (status === "blocked" || status === "needs_review") return "warning";
  if (status === "failed") return "error";
  return "accent";
}

export function Jobs({ jobs, onApprove, onSkip, onQueue }: JobsProps) {
  const [portal, setPortal] = useState("all");
  const [status, setStatus] = useState("all");
  const [minScore, setMinScore] = useState(60);
  const [selectedId, setSelectedId] = useState(jobs[0]?.id || "");
  const [tailorJob, setTailorJob] = useState<JobMatch | null>(null);

  const filtered = useMemo(
    () =>
      jobs.filter((job) => {
        const portalMatch = portal === "all" || job.portal === portal;
        const statusMatch = status === "all" || job.status === status;
        return portalMatch && statusMatch && job.score >= minScore && job.status !== "skipped";
      }),
    [jobs, minScore, portal, status]
  );

  const selected = filtered.find((job) => job.id === selectedId) || filtered[0];
  const portals = Array.from(new Set(jobs.map((job) => job.portal)));

  return (
    <>
      <section className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Job matches</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Review scored jobs one at a time. When you click apply, Hunter runs a quick safety check and submits if everything is ready.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
            <Metric label="To review" value={jobs.filter((job) => job.status === "pending").length} />
            <Metric label="Blocked" value={jobs.filter((job) => job.status === "blocked").length} tone="warning" />
            <Metric label="Ready" value={jobs.filter((job) => job.status === "applying" || job.status === "approved").length} tone="success" />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-sm">
          <StatusPill label="Resume parsed" tone="success" />
          <StatusPill label="Preferences saved" tone="success" />
          <StatusPill label="Portals connected" tone="accent" />
          <StatusPill label="Safety check before apply" tone="warning" />
        </div>
      </section>

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
        <SlidersHorizontal size={18} className="mb-2 text-[var(--text-muted)]" />
        <label className="text-sm">
          Portal
          <select value={portal} onChange={(event) => setPortal(event.target.value)} className="terminal-field mt-1 block h-9 rounded-md px-3">
            <option value="all">All portals</option>
            {portals.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="terminal-field mt-1 block h-9 rounded-md px-3">
            <option value="all">All statuses</option>
            {["pending", "approved", "applying", "blocked", "needs_review", "failed"].map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Score
          <input value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} type="number" min={0} max={100} className="terminal-field mt-1 block h-9 w-24 rounded-md px-3" />
        </label>
        <button type="button" className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]">
          Saved views
        </button>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="air-surface overflow-hidden rounded-lg">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div>
              <h2 className="text-base font-semibold">Jobs to review</h2>
              <p className="text-xs text-[var(--text-muted)]">{filtered.length} jobs match the current filters</p>
            </div>
            <MoreHorizontal size={18} className="text-[var(--text-muted)]" />
          </div>
          <div>
            {filtered.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedId(job.id)}
                className={`air-row grid w-full gap-3 px-4 py-4 text-left transition hover:bg-[var(--bg-elevated)] md:grid-cols-[72px_1fr_120px_120px_92px] ${
                  selected?.id === job.id ? "bg-[var(--bg-elevated)]" : "bg-[var(--bg-surface)]"
                }`}
              >
                <div className="flex items-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border text-sm font-semibold" style={{ color: scoreColor(job.score), borderColor: scoreColor(job.score) }}>
                    {job.score}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{job.title}</p>
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{job.company} - {job.location}</p>
                </div>
                <div className="flex items-center">
                  <StatusPill label={job.portal} tone="neutral" />
                </div>
                <div className="flex items-center">
                  <StatusPill label={job.status} tone={statusTone(job.status)} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    {job.status === "blocked" || job.status === "needs_review" || job.status === "failed" ? <AlertTriangle size={14} style={{ color: "var(--state-warning)" }} /> : <ShieldCheck size={14} style={{ color: "var(--state-success)" }} />}
                    {job.status === "blocked" || job.status === "needs_review" || job.status === "failed" ? "Caution" : "Ready"}
                  </span>
                  <MoreHorizontal size={16} className="text-[var(--text-muted)]" />
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="air-surface rounded-lg p-4 xl:sticky xl:top-24 xl:self-start">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Selected match</p>
                  <h2 className="mt-2 text-xl font-semibold">{selected.title}</h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">{selected.company} - {selected.portal}</p>
                </div>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-lg font-semibold" style={{ color: scoreColor(selected.score), borderColor: scoreColor(selected.score) }}>
                  {selected.score}
                </div>
              </div>

              <div className="mt-5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Brain size={14} /> JD summary</p>
                <p className="mt-2 text-sm leading-6">{selected.jdSummary}</p>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold">AI fit</p>
                <div className="mt-3 space-y-3">
                  {[
                    ["Skills match", 92],
                    ["Experience match", 88],
                    ["Apply safety", selected.status === "blocked" || selected.status === "needs_review" || selected.status === "failed" ? 42 : 100],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="text-[var(--text-muted)]">{value}%</span></div>
                      <div className="h-1.5 rounded-full bg-[var(--bg-elevated)]">
                        <div className="h-full rounded-full bg-[var(--accent-primary)]" style={{ width: `${value}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-5 grid gap-4">
                <SkillGroup title="Matched skills" skills={selected.matchedSkills} tone="success" />
                <SkillGroup title="Missing skills" skills={selected.missingSkills} />
              </div>

              <div className="mt-5 rounded-lg border border-[var(--border-default)] p-3 text-sm">
                <p className="font-medium">Resume version</p>
                <p className="mt-1 text-[var(--text-muted)]">Base resume + approved tailored drafts</p>
              </div>

              <p className="mt-4 flex gap-2 rounded-lg bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
                <ShieldCheck size={16} style={{ color: "var(--state-success)" }} />
                Hunter checks the portal session, duplicate risk, resume availability, and source status before submitting.
              </p>

              <div className="mt-5 grid grid-cols-3 gap-2">
                <button type="button" onClick={() => setTailorJob(selected)} className="air-button h-10 border border-[var(--border-default)] text-[var(--text-primary)] hover:border-[var(--accent-primary)]">
                  <FileText size={15} />
                  Tailor
                </button>
                {selected.status === "approved" ? (
                  <button type="button" onClick={() => onQueue(selected.id)} className="air-button h-10 bg-[var(--state-success)] text-white">
                    <Send size={15} />
                    Apply now
                  </button>
                ) : selected.status === "applying" ? (
                  <button type="button" disabled className="air-button h-10 bg-[var(--state-success)] text-white opacity-80">
                    <Send size={15} />
                    Applying
                  </button>
                ) : (
                  <button type="button" onClick={() => onApprove(selected.id)} disabled={selected.status !== "pending"} className="air-button h-10 bg-[var(--accent-primary)] text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                    <CheckCircle size={15} />
                    Approve
                  </button>
                )}
                <button type="button" onClick={() => onSkip(selected.id)} disabled={selected.status === "applying" || selected.status === "applied"} className="air-button h-10 border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--state-error)] disabled:cursor-not-allowed disabled:opacity-50">
                  <XCircle size={15} />
                  Skip
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">No jobs match the current filters.</p>
          )}
        </aside>
      </div>

      {tailorJob && <TailorModal job={tailorJob} onClose={() => setTailorJob(null)} />}
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: "success" | "warning" }) {
  return (
    <div className="min-w-24 px-3 py-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: tone === "success" ? "var(--state-success)" : tone === "warning" ? "var(--state-warning)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

function SkillGroup({ title, skills, tone }: { title: string; skills: string[]; tone?: "success" }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <span
            key={skill}
            className="rounded px-2 py-1 text-xs"
            style={
              tone === "success"
                ? { color: "var(--state-success)", background: "color-mix(in srgb, var(--state-success) 12%, transparent)" }
                : { color: "var(--text-muted)", background: "var(--bg-elevated)" }
            }
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}
