import type { Application, ApplicationStatus, JobMatch, JobStatus } from "../types";

type AnyRecord = Record<string, unknown>;

export function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinList(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return typeof value === "string" ? value : "";
}

export function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "Not updated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function mapJobMatch(row: AnyRecord): JobMatch {
  const job = asRecord(row.jobs);
  const description = text(job.description);
  const reasons = stringArray(row.match_reasons);

  return {
    id: text(row.id || row.job_id || job.id),
    title: text(job.title, "Untitled role"),
    company: text(job.company, "Unknown company"),
    portal: text(job.portal || row.portal, "unknown"),
    location: text(job.location, "Not specified"),
    salary: text(job.salary, "Not disclosed"),
    experience: text(job.experience, "Not specified"),
    score: numberValue(row.match_score ?? row.score),
    status: normalizeJobStatus(row.status),
    matchedSkills: stringArray(row.matched_skills),
    missingSkills: stringArray(row.missing_skills),
    note: reasons.join(" ") || text(row.blocked_reason || row.failed_reason || row.notes),
    jdSummary: description ? summarize(description) : "No job description snapshot is available yet.",
  };
}

export function mapApplication(row: AnyRecord): Application {
  const job = asRecord(row.jobs);
  const blockedReason = text(row.blocked_reason);
  const failedReason = text(row.failed_reason);
  const notes = text(row.notes);
  const warning = blockedReason || failedReason || (normalizeApplicationStatus(row.status) === "needs_review" ? "Needs review before apply" : "");

  return {
    id: text(row.id),
    title: text(job.title, "Untitled role"),
    company: text(job.company, "Unknown company"),
    portal: text(row.portal || job.portal, "unknown"),
    location: text(job.location, "Not specified"),
    status: normalizeApplicationStatus(row.status),
    score: numberValue(row.match_score ?? row.score),
    latestDate: formatDate(row.updated_at || row.applied_at),
    warning: warning || undefined,
    resumeVersion: text(row.resume_version, "Uploaded resume"),
    applyResponse: portalResponseText(row.portal_response) || blockedReason || failedReason || notes || "No portal response recorded yet.",
    notes,
  };
}

function normalizeJobStatus(value: unknown): JobStatus {
  const status = text(value, "pending");
  if (
    [
      "pending",
      "approved",
      "applying",
      "queued",
      "applied",
      "skipped",
      "blocked",
      "failed",
      "needs_review",
    ].includes(status)
  ) {
    return status as JobStatus;
  }
  return "pending";
}

function normalizeApplicationStatus(value: unknown): ApplicationStatus {
  const status = text(value, "applied");
  if (
    [
      "fetched",
      "approved",
      "applied",
      "viewed",
      "interview",
      "offer",
      "rejected",
      "archived",
      "blocked",
      "failed",
      "needs_review",
    ].includes(status)
  ) {
    return status as ApplicationStatus;
  }
  return "applied";
}

function portalResponseText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;

  const response = asRecord(value);
  const reason = text(response.reason);
  if (reason) return reason;

  const jobs = Array.isArray(response.jobs) ? response.jobs : [];
  const messages = jobs
    .map((item) => text(asRecord(item).message))
    .filter(Boolean);
  if (messages.length) return messages.join(" | ");

  const success = response.success;
  if (typeof success === "boolean") return success ? "Portal apply completed." : "Portal apply failed.";

  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return "";
  }
}

function summarize(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 260 ? `${compact.slice(0, 260)}...` : compact;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item)).filter(Boolean);
  }
  if (typeof value === "string" && value.includes(",")) return splitList(value);
  return typeof value === "string" && value ? [value] : [];
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
