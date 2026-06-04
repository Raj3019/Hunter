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
  | "needs_review";
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
  | "needs_review";

export interface JobMatch {
  id: string;
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
  note: string;
  jdSummary: string;
}

export interface Application {
  id: string;
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
}
