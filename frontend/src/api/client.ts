import axios, { type AxiosProgressEvent } from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000",
});
const MANUAL_SEARCH_TIMEOUT_MS = 180_000;

// Company career portals with clean credential login + applied-status auto-detect
// (SuccessFactors: Wipro/HCLTech; Keycloak+REST: Infosys). Adding another is a
// backend registry entry + a key here.
export const CAREER_PORTAL_KEYS = ["wipro", "hcltech", "infosys", "capgemini"];

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = String(error.config?.url || "");
    if (error.response?.status === 401 && !url.includes("/api/auth/")) {
      localStorage.removeItem("access_token");
      window.location.href = "/auth";
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (email: string, password: string) => api.post("/api/auth/login", { email, password }),
  register: (email: string, password: string, fullName: string) =>
    api.post("/api/auth/register", { email, password, full_name: fullName }),
  me: () => api.get("/api/auth/me"),
  updateProfile: (payload: { full_name?: string; phone?: string }) => api.patch("/api/auth/me", payload),
};

export const resumeAPI = {
  upload: (file: File, onUploadProgress?: (event: AxiosProgressEvent) => void) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/api/resume/upload", form, { onUploadProgress });
  },
  getParsed: () => api.get("/api/resume/parsed"),
};

export const preferencesAPI = {
  save: (preferences: object) => api.post("/api/preferences", preferences),
  get: () => api.get("/api/preferences"),
};

export const portalsAPI = {
  getStatus: () => api.get("/api/portals/status"),
  saveNaukriCredentials: (username: string, password: string) =>
    api.post("/api/portals/naukri/credentials", { username, password }),
  disconnectNaukri: () => api.delete("/api/portals/naukri"),
  saveNaukriToken: (bearer_token: string, profile_id: string) =>
    api.post("/api/portals/naukri/token", { bearer_token, profile_id }),
  saveFounditToken: (bearer_token: string, user_id_str: string) =>
    api.post("/api/portals/foundit/token", { bearer_token, user_id_str }),
  saveFounditCredentials: (username: string, password: string) =>
    api.post("/api/portals/foundit/credentials", { username, password }),
  disconnectFoundit: () => api.delete("/api/portals/foundit"),
  saveCareerCredentials: (portalKey: string, username: string, password: string) =>
    api.post(`/api/portals/${portalKey}/credentials`, { username, password }),
  disconnectCareer: (portalKey: string) => api.delete(`/api/portals/career/${portalKey}`),
};

export const jobsAPI = {
  getMatches: () => api.get("/api/jobs/matches"),
  search: (payload: {
    query?: string;
    locations?: string[];
    experience_years?: number;
    portals?: string[];
    page?: number;
    results_per_page?: number;
    min_score?: number;
    freshness_days?: number;
    save_as_preferences?: boolean;
  }) => api.post("/api/jobs/search", payload, { timeout: MANUAL_SEARCH_TIMEOUT_MS }),
  approve: (id: string) => api.post(`/api/jobs/${id}/approve`),
  skip: (id: string) => api.post(`/api/jobs/${id}/skip`),
  tailor: (id: string) => api.post(`/api/jobs/${id}/tailor`),
  approveTailored: (id: string, tailored_resume_id: string) =>
    api.post(`/api/jobs/${id}/tailor/approve`, { tailored_resume_id }),
  openPortal: (id: string) => api.post(`/api/jobs/${id}/open-portal`),
  openPortalSnapshot: (job: object) => api.post("/api/jobs/open-portal-snapshot", { job }),
  apply: (id: string) => api.post(`/api/jobs/${id}/apply`),
  applySnapshot: (job: object) => api.post("/api/jobs/apply-snapshot", { job }),
};

export const applicationsAPI = {
  getAll: () => api.get("/api/applications"),
  updateStatus: (id: string, status: string, notes?: string) =>
    api.patch(`/api/applications/${id}`, { status, notes }),
  syncNaukri: () => api.post("/api/applications/sync-naukri"),
  syncFoundit: () => api.post("/api/applications/sync-foundit"),
  syncCareer: (portalKey: string) => api.post(`/api/applications/sync-career/${portalKey}`),
};

export const companyAccountsAPI = {
  save: (company_key: string, username: string, password: string) =>
    api.post("/api/company-accounts", { company_key, username, password }),
  getAll: () => api.get("/api/company-accounts"),
  checkStatus: (company_key: string) => api.get(`/api/company-accounts/${company_key}/status`),
  delete: (company_key: string) => api.delete(`/api/company-accounts/${company_key}`),
};

export function apiErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNABORTED") {
      return "Search is taking too long. Try again with a narrower query or open the portal directly if this repeats.";
    }
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || item?.message || String(item)).join(", ");
    if (error.message) return error.message;
  }
  return fallback;
}

export default api;
