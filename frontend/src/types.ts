export type Theme = "dark" | "light";
export type JobStatus =
  | "pending"
  | "approved"
  | "applying"
  | "queued"
  | "applied"
  | "skipped"
  | "blocked"
  | "failed"
  | "needs_review"
  | "external_pending";
export type ApplicationStatus =
  | "fetched"
  | "approved"
  | "applied"
  | "viewed"
  | "interview"
  | "offer"
  | "rejected"
  | "archived"
  | "blocked"
  | "failed"
  | "needs_review"
  | "external_pending";

export interface JobMatch {
  id: string;
  jobId?: string;
  title: string;
  company: string;
  portal: string;
  location: string;
  salary: string;
  experience: string;
  score: number;
  status: JobStatus;
  matchedSkills: string[];
  missingSkills: string[];
  scoreBreakdown?: { merits: string[]; demerits: string[] };
  note: string;
  jdSummary: string;
  jdFullDescription?: string;
  companyLogoUrl?: string;
  tailoredResumeApproved: boolean;
  tailoredResumeVersion: string;
  applyMethod?: string;
  externalApplyUrl?: string;
  persisted?: boolean;
  recommendationBasis?: "resume_and_preferences" | "resume" | "preferences" | "search";
  recommendationLabel?: string;
  recommended?: boolean;
  resumeAvailable?: boolean;
  preferencesAvailable?: boolean;
  preferenceScore?: number;
  preferenceMatchedTerms?: string[];
}

export interface Application {
  id: string;
  jobId?: string;
  title: string;
  company: string;
  portal: string;
  location: string;
  status: ApplicationStatus;
  score: number;
  latestDate: string;
  warning?: string;
  resumeVersion: string;
  applyResponse: string;
  notes: string;
  companyLogoUrl?: string;
  externalApplyUrl?: string;
  externalApplyConfirmedAt?: string;
  arsScore?: number;
  companyRating?: number;
}

export interface SearchRunSummary {
  query: string;
  locations: string[];
  fetchedCount: number;
  savedCount: number;
  recommendedCount: number;
  minScore: number;
}
