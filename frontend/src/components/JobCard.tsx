import { BriefcaseBusiness, CheckCircle, FileText, MapPin, Send, XCircle } from "lucide-react";
import { StatusPill } from "./StatusPill";
import type { JobMatch } from "../types";

interface JobCardProps {
  job: JobMatch;
  selected?: boolean;
  compact?: boolean;
  onApprove: (id: string) => void;
  onSkip: (id: string) => void;
  onTailor: (job: JobMatch) => void;
  onQueue: (id: string) => void;
  onSelect?: (job: JobMatch) => void;
}

function scoreColor(score: number) {
  if (score >= 80) return "var(--score-high)";
  if (score >= 60) return "var(--score-mid)";
  return "var(--score-low)";
}

export function JobCard({ job, selected, compact, onApprove, onSkip, onTailor, onQueue, onSelect }: JobCardProps) {
  const canApprove = job.status === "pending";
  const canApply = job.status === "approved";
  const isDone = job.status === "applied" || job.status === "queued" || job.status === "skipped";
  const statusTone = job.status === "approved" || job.status === "queued" || job.status === "applied" ? "success" : job.status === "blocked" ? "warning" : "accent";

  return (
    <article
      className={`desk-panel group relative overflow-hidden rounded-xl p-0 transition hover:-translate-y-0.5 ${
        selected ? "border-[var(--accent-primary)]" : "border-[var(--border-default)]"
      }`}
      onClick={() => onSelect?.(job)}
    >
      <div className="absolute inset-y-0 left-0 w-1" style={{ background: scoreColor(job.score) }} />
      <div className="grid gap-4 p-4 lg:grid-cols-[82px_1fr]">
        <div className="flex lg:block">
          <div
            className="flex h-16 w-20 flex-col items-center justify-center rounded-xl border bg-[var(--bg-elevated)]"
            style={{ color: scoreColor(job.score), borderColor: scoreColor(job.score) }}
          >
            <span className="text-2xl font-semibold leading-none">{job.score}</span>
            <span className="text-[10px] font-medium uppercase tracking-wide">match</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill label={job.portal} tone="neutral" />
            <StatusPill label={job.status} tone={statusTone} />
            <span className="text-xs text-[var(--text-muted)]">{job.salary}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{job.title}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1"><BriefcaseBusiness size={13} />{job.company}</span>
                <span className="inline-flex items-center gap-1"><MapPin size={13} />{job.location}</span>
                <span>{job.experience}</span>
              </p>
            </div>
            <div className="hidden min-w-28 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs text-[var(--text-muted)] sm:block">
              AI fit reviewed
            </div>
          </div>

          {!compact && (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
              {job.note}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {job.matchedSkills.slice(0, compact ? 3 : 5).map((skill) => (
              <span key={skill} className="rounded border border-transparent px-2 py-1 text-xs" style={{ background: "color-mix(in srgb, var(--state-success) 13%, transparent)", color: "var(--state-success)" }}>
                {skill}
              </span>
            ))}
            {job.missingSkills.slice(0, compact ? 2 : 3).map((skill) => (
              <span key={skill} className="rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-muted)]">
                {skill}
              </span>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-default)] pt-3">
            {canApprove && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onApprove(job.id);
                }}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
              >
                <CheckCircle size={15} />
                Approve
              </button>
            )}
            {job.status === "blocked" && (
              <span className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-2 text-sm font-medium text-[var(--text-muted)]">
                Blocked
              </span>
            )}
            {canApply && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onQueue(job.id);
                }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-white"
                style={{ background: "var(--state-success)" }}
              >
                <Send size={15} />
                Apply
              </button>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTailor(job);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
            >
              <FileText size={15} />
              Tailor
            </button>
            {!isDone && job.status !== "blocked" && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSkip(job.id);
                }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--state-error)]"
              >
                <XCircle size={15} />
                Skip
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
