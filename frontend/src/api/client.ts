import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8000",
});

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
  register: (email: string, password: string) => api.post("/api/auth/register", { email, password }),
};

export const resumeAPI = {
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post("/api/resume/upload", form);
  },
  getParsed: () => api.get("/api/resume/parsed"),
};

export const preferencesAPI = {
  save: (preferences: object) => api.post("/api/preferences", preferences),
  get: () => api.get("/api/preferences"),
};

export const portalsAPI = {
  getStatus: () => api.get("/api/portals/status"),
  saveNaukriToken: (bearer_token: string, profile_id: string) =>
    api.post("/api/portals/naukri/token", { bearer_token, profile_id }),
  saveFounditToken: (bearer_token: string, user_id_str: string) =>
    api.post("/api/portals/foundit/token", { bearer_token, user_id_str }),
  confirmLinkedIn: () => api.post("/api/portals/linkedin/setup"),
};

export const jobsAPI = {
  getMatches: () => api.get("/api/jobs/matches"),
  approve: (id: string) => api.post(`/api/jobs/${id}/approve`),
  skip: (id: string) => api.post(`/api/jobs/${id}/skip`),
  tailor: (id: string) => api.post(`/api/jobs/${id}/tailor`),
  approveTailored: (id: string, tailored_resume_url = "", tailored_resume_version = "tailored") =>
    api.post(`/api/jobs/${id}/tailor/approve`, { tailored_resume_url, tailored_resume_version }),
  apply: (id: string) => api.post(`/api/jobs/${id}/apply`),
};

export const applicationsAPI = {
  getAll: () => api.get("/api/applications"),
  updateStatus: (id: string, status: string, notes?: string) =>
    api.patch(`/api/applications/${id}`, { status, notes }),
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
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || item?.message || String(item)).join(", ");
    if (error.message) return error.message;
  }
  return fallback;
}

export default api;
