import { AlertTriangle, RefreshCw, Save, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiErrorMessage, jobsAPI } from "../api/client";
import type { JobMatch } from "../types";

interface TailorModalProps {
  job: JobMatch;
  onClose: () => void;
}

export function TailorModal({ job, onClose }: TailorModalProps) {
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");
  const [tailored, setTailored] = useState<unknown>(null);

  const loadTailoring = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await jobsAPI.tailor(job.id);
      setTailored(response.data?.tailored || null);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not generate tailoring suggestions."));
    } finally {
      setLoading(false);
    }
  };

  const approveTailored = async () => {
    setApproving(true);
    setError("");
    try {
      await jobsAPI.approveTailored(job.id, "", `tailored:${new Date().toISOString()}`);
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not approve tailored resume."));
    } finally {
      setApproving(false);
    }
  };

  useEffect(() => {
    void loadTailoring();
  }, [job.id]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto flex max-h-full max-w-6xl flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Tailor resume: {job.title} @ {job.company}</h2>
            <p className="text-xs text-[var(--text-muted)]">Review before any tailored resume is used.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tailor modal"
            title="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-default)]"
          >
            <X size={16} />
          </button>
        </header>
        <div className="grid gap-4 overflow-auto p-4 lg:grid-cols-2">
          <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-4">
            <h3 className="text-sm font-medium">Current resume sections</h3>
            <pre className="mt-3 whitespace-pre-wrap rounded bg-[var(--bg-elevated)] p-3 font-mono text-xs leading-6 text-[var(--text-muted)]">
{`Summary
Frontend engineer with React and automation experience.

Skills
React, TypeScript, Python, FastAPI, Playwright

Projects
Dashboard workflows, browser automation, API integrations`}
            </pre>
          </section>
          <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-4">
            <h3 className="text-sm font-medium">Tailored suggestion</h3>
            <pre className="mt-3 whitespace-pre-wrap rounded bg-[var(--bg-elevated)] p-3 font-mono text-xs leading-6 text-[var(--text-primary)]">
{loading ? "Generating tailored suggestions..." : error || formatTailored(tailored, job)}
            </pre>
          </section>
        </div>
        <div className="border-t border-[var(--border-default)] px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {job.missingSkills.map((skill) => (
              <span key={skill} className="rounded bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-muted)]">
                Missing: {skill}
              </span>
            ))}
            {job.matchedSkills.map((skill) => (
              <span key={skill} className="rounded px-2 py-1 text-xs" style={{ color: "var(--state-success)", background: "color-mix(in srgb, var(--state-success) 14%, transparent)" }}>
                Matched: {skill}
              </span>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} />
              AI changes need approval before use.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadTailoring} disabled={loading} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-60">
                <RefreshCw size={15} />
                Regenerate
              </button>
              <button type="button" disabled={!tailored || loading} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm disabled:opacity-60">
                <Save size={15} />
                Save draft
              </button>
              <button type="button" onClick={approveTailored} disabled={approving || loading || !tailored} className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {approving ? "Approving..." : "Approve tailored resume"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTailored(value: unknown, job: JobMatch): string {
  if (!value) {
    return `No tailored suggestion returned yet for ${job.company}.`;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "Tailored suggestion is available, but could not be rendered.";
  }
}
