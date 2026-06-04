import { AlertTriangle, Download, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { apiErrorMessage, jobsAPI, resumeAPI } from "../api/client";
import type { JobMatch } from "../types";

interface TailorModalProps {
  job: JobMatch;
  onClose: () => void;
}

interface TailoredValidation {
  ok?: boolean;
  blocked_claims?: string[];
  warnings?: string[];
  removed_skills?: string[];
}

interface TailoredDraft {
  id?: string;
  status?: string;
  file_url?: string;
  file_type?: string;
  version?: string;
  validation?: TailoredValidation;
}

export function TailorModal({ job, onClose }: TailorModalProps) {
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");
  const [tailored, setTailored] = useState<unknown>(null);
  const [draft, setDraft] = useState<TailoredDraft | null>(null);
  const [parsedResume, setParsedResume] = useState<Record<string, unknown> | null>(null);

  const loadTailoring = async () => {
    setLoading(true);
    setError("");
    setTailored(null);
    setDraft(null);
    try {
      const response = await jobsAPI.tailor(job.id);
      setTailored(response.data?.tailored || null);
      setDraft(response.data?.draft || null);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not generate tailored resume draft."));
    } finally {
      setLoading(false);
    }
  };

  const loadResume = async () => {
    try {
      const response = await resumeAPI.getParsed();
      setParsedResume(asRecord(response.data?.parsed_data));
    } catch {
      setParsedResume(null);
    }
  };

  const approveTailored = async () => {
    if (!draft?.id) {
      setError("Generate a tailored resume draft before approving.");
      return;
    }

    setApproving(true);
    setError("");
    try {
      await jobsAPI.approveTailored(job.id, draft.id);
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not approve tailored resume."));
    } finally {
      setApproving(false);
    }
  };

  useEffect(() => {
    void loadResume();
    void loadTailoring();
  }, [job.id]);

  const validationOk = draft ? (draft.validation?.ok ?? draft.status !== "failed_validation") : false;
  const validationLabel = draft ? (validationOk ? "passed" : "blocked") : "pending";
  const validationColor = draft ? (validationOk ? "var(--state-success)" : "var(--state-error)") : "var(--text-muted)";
  const blockedClaims = draft?.validation?.blocked_claims || [];
  const warnings = draft?.validation?.warnings || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto flex max-h-full max-w-6xl flex-col rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]">
        <header className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Tailor resume: {job.title} @ {job.company}</h2>
            <p className="text-xs text-[var(--text-muted)]">Job-specific resume draft</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <MetaChip label="Version" value={draft?.version || "Generating"} />
              <MetaChip label="Status" value={draft?.status || (loading ? "drafting" : "not ready")} />
              <MetaChip label="File" value={(draft?.file_type || "docx").toUpperCase()} />
            </div>
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
              {formatCurrentResume(parsedResume)}
            </pre>
          </section>
          <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-4">
            <h3 className="text-sm font-medium">Generated tailored draft</h3>
            <pre className="mt-3 whitespace-pre-wrap rounded bg-[var(--bg-elevated)] p-3 font-mono text-xs leading-6 text-[var(--text-primary)]">
              {loading ? "Generating tailored resume draft..." : error || formatTailored(tailored, job)}
            </pre>
          </section>
        </div>
        <div className="border-t border-[var(--border-default)] px-4 py-3">
          <div className="mb-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <p className="inline-flex items-center gap-2 text-sm font-medium">
              <ShieldCheck size={16} style={{ color: validationColor }} />
              Validation {validationLabel}
            </p>
            {(blockedClaims.length > 0 || warnings.length > 0) && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5 text-[var(--text-muted)]">
                {formatValidation(blockedClaims, warnings)}
              </pre>
            )}
          </div>
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
              {draft?.file_url ? (
                <a href={draft.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm">
                  <Download size={15} />
                  Download draft
                </a>
              ) : (
                <button type="button" disabled className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] px-3 py-2 text-sm opacity-60">
                  <Download size={15} />
                  Download draft
                </button>
              )}
              <button type="button" onClick={approveTailored} disabled={approving || loading || !draft?.id || !validationOk} className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                {approving ? "Approving..." : "Approve tailored resume"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-2 py-1 text-[var(--text-muted)]">
      {label}: <span className="text-[var(--text-primary)]">{value}</span>
    </span>
  );
}

function formatCurrentResume(resume: Record<string, unknown> | null): string {
  if (!resume) {
    return "Resume sections will appear after the parsed resume is loaded.";
  }

  const lines = [
    section("Name", [text(resume.name, "Parsed candidate")]),
    section("Role", [text(resume.current_role), text(resume.total_experience_years) ? `${text(resume.total_experience_years)} years experience` : ""]),
    section("Summary", [text(resume.summary, "Summary parsed from uploaded resume.")]),
    section("Skills", stringArray(resume.skills)),
    section("Education", [text(resume.education)]),
  ].filter(Boolean);

  return lines.join("\n\n");
}

function formatTailored(value: unknown, job: JobMatch): string {
  if (!value) {
    return `No tailored suggestion returned yet for ${job.company}.`;
  }

  if (typeof value === "string") {
    return value;
  }

  const record = asRecord(value);
  const lines = [
    section("Summary", [text(record.tailored_summary)]),
    section("Reordered skills", stringArray(record.reordered_skills)),
    section("Experience highlights", stringArray(record.highlighted_experience)),
    section("Changes made", stringArray(record.changes_made)),
    section("Warnings", [text(record.warnings)]),
  ].filter(Boolean);

  return lines.join("\n\n") || "Tailored suggestion is available, but could not be rendered.";
}

function formatValidation(blockedClaims: string[], warnings: string[]): string {
  return [
    blockedClaims.length ? section("Blocked claims", blockedClaims) : "",
    warnings.length ? section("Warnings", warnings) : "",
  ].filter(Boolean).join("\n\n");
}

function section(title: string, lines: string[]): string {
  const clean = lines.filter(Boolean);
  if (!clean.length) return "";
  return `${title}\n${clean.map((line) => `- ${line}`).join("\n")}`;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string" && value.includes(",")) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number") return String(value);
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
