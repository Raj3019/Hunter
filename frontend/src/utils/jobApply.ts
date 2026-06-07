import type { JobMatch, JobStatus } from "../types";

export function isExternalApplyJob(job: JobMatch): boolean {
  const method = (job.applyMethod || "unknown").toLowerCase();
  if (job.status === "external_pending" || method === "external") return true;
  if (method === "native" || method === "ats_supported") return false;

  return false;
}

export function displayJobStatus(job: JobMatch): JobStatus {
  return job.status;
}

// Friendly, user-facing labels for the raw status strings. Used only for display;
// logic/comparisons keep using the raw status values.
const STATUS_LABELS: Record<string, string> = {
  pending: "In review",
  approved: "Approved",
  applying: "Applying",
  queued: "Queued",
  applied: "Applied",
  skipped: "Skipped",
  blocked: "Blocked",
  failed: "Apply failed",
  needs_review: "Needs review",
  external_pending: "Portal pending",
  fetched: "Fetched",
  viewed: "Viewed",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  archived: "Archived",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

export function openExternalApply(url: string | undefined) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
