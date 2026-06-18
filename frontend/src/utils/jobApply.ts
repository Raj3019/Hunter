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
  external_pending: "Awaiting confirmation",
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

// Snapshot of a session-only search result, sent to the backend to persist it (for
// open-portal or tailoring). Shared by App and Jobs so the shape stays in sync.
export function jobSnapshotPayload(job: JobMatch) {
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
