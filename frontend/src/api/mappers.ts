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
  const description = cleanJobDescription(text(job.description));
  const reasons = stringArray(row.match_reasons);
  const recommendation = asRecord(row.recommendation_context);

  return {
    id: text(row.id || row.job_id || job.id),
    jobId: text(row.job_id || job.id),
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
    jdFullDescription: description,
    tailoredResumeApproved: Boolean(row.tailored_resume_approved),
    tailoredResumeVersion: text(row.tailored_resume_version),
    applyMethod: text(job.apply_method, "unknown"),
    externalApplyUrl: normalizeApplyUrl(job.external_apply_url || row.external_apply_url || job.apply_link, text(job.portal || row.portal, "unknown")),
    persisted: row.persisted !== false,
    recommendationBasis: normalizeRecommendationBasis(recommendation.basis),
    recommendationLabel: text(recommendation.label, "Search result"),
    recommended: Boolean(recommendation.recommended),
    resumeAvailable: Boolean(recommendation.resume_available),
    preferencesAvailable: Boolean(recommendation.preferences_available),
    preferenceScore: numberValue(recommendation.preference_score),
    preferenceMatchedTerms: stringArray(recommendation.preference_matched_terms),
  };
}

export function mapApplication(row: AnyRecord): Application {
  const job = asRecord(row.jobs);
  const blockedReason = text(row.blocked_reason);
  const failedReason = text(row.failed_reason);
  const notes = text(row.notes);
  const normalizedStatus = normalizeApplicationStatus(row.status);
  const warning =
    blockedReason ||
    failedReason ||
    (normalizedStatus === "external_pending"
      ? "Complete this application on the original portal, then confirm the result."
      : normalizedStatus === "needs_review"
        ? "Needs review before apply"
        : "");
  const portalResponse = asRecord(row.portal_response);

  return {
    id: text(row.id),
    jobId: text(row.job_id || job.id),
    title: text(job.title, "Untitled role"),
    company: text(job.company, "Unknown company"),
    portal: text(row.portal || job.portal, "unknown"),
    location: text(job.location, "Not specified"),
    status: normalizedStatus,
    score: numberValue(row.match_score ?? row.score),
    latestDate: formatDate(row.updated_at || row.applied_at),
    warning: warning || undefined,
    resumeVersion: text(row.resume_version, "Uploaded resume"),
    applyResponse: portalResponseText(row.portal_response) || blockedReason || failedReason || notes || "No portal response recorded yet.",
    notes,
    externalApplyUrl: normalizeApplyUrl(row.external_apply_url || job.external_apply_url || portalResponse.external_apply_url || job.apply_link, text(row.portal || job.portal, "unknown")),
    externalApplyConfirmedAt: text(row.external_apply_confirmed_at),
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
      "external_pending",
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
      "external_pending",
    ].includes(status)
  ) {
    return status as ApplicationStatus;
  }
  return "applied";
}

function normalizeRecommendationBasis(value: unknown): JobMatch["recommendationBasis"] {
  const basis = text(value, "search");
  if (["resume_and_preferences", "resume", "preferences", "search"].includes(basis)) {
    return basis as JobMatch["recommendationBasis"];
  }
  return "search";
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

function cleanJobDescription(value: string): string {
  if (!value) return "";
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n");

  if (/<[a-z][\s\S]*>/i.test(withBreaks) && typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(withBreaks, "text/html");
      return normalizeText(doc.body.textContent || withBreaks);
    } catch {
      // Fall back to the lightweight tag stripper below.
    }
  }

  return normalizeText(
    withBreaks
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );
}

function normalizeText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function normalizeApplyUrl(value: unknown, portal: string): string {
  const raw = text(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const path = raw.startsWith("/") ? raw : `/${raw}`;
  const normalizedPortal = portal.toLowerCase();
  if (normalizedPortal === "naukri") return `https://www.naukri.com${path}`;
  if (normalizedPortal === "foundit") return `https://www.foundit.in${path}`;
  if (normalizedPortal === "linkedin") return `https://www.linkedin.com${path}`;
  return raw;
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
