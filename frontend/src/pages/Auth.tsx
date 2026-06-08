import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { BrandMark } from "../components/BrandMark";
import { useToast } from "../components/Toast";
import { apiErrorMessage, authAPI, preferencesAPI, resumeAPI } from "../api/client";

type AuthMode = "login" | "register" | "forgot";

export function Auth() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");

    try {
      if (mode === "forgot") {
        setError("Reset link delivery needs the backend email provider to be configured.");
        return;
      }

      const response = mode === "register" ? await authAPI.register(email, password) : await authAPI.login(email, password);
      const token = response.data?.access_token;
      if (token) {
        localStorage.setItem("access_token", token);
        toast.success(mode === "register" ? "Account created. Welcome to Hunter!" : "Signed in.");
        const target = (location.state as { from?: string } | null)?.from;
        navigate(target || await firstRunRoute(), { replace: true });
        return;
      }

      setMessage(response.data?.message || "Account created. Confirm your email, then sign in.");
      setMode("login");
    } catch (caught) {
      setError(apiErrorMessage(caught, mode === "register" ? "Could not create account." : "Could not sign in."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="flex h-20 items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-4 backdrop-blur lg:px-8">
        <BrandMark />
      </header>
      <section className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-8">
        <form onSubmit={submit} className="desk-panel w-full max-w-sm rounded-xl p-5">
          <h1 className="text-lg font-semibold">{mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Reset access"}</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Use your Hunter account to continue.</p>
          <label className="mt-5 block text-sm">
            Email
            <input name="email" className="terminal-field mt-1 h-10 w-full rounded-lg px-3" type="email" required />
          </label>
          {mode !== "forgot" && (
            <label className="mt-3 block text-sm">
              Password
              <input name="password" className="terminal-field mt-1 h-10 w-full rounded-lg px-3" type="password" required />
            </label>
          )}
          {message && (
            <p className="mt-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
              {message}
            </p>
          )}
          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
              <AlertTriangle size={16} style={{ color: "var(--state-warning)" }} />
              {error}
            </p>
          )}
          <button type="submit" className="mt-4 h-10 w-full rounded-md bg-[var(--accent-primary)] text-sm font-medium text-white hover:bg-[var(--accent-hover)]">
            {loading ? "Working..." : "Continue"}
          </button>
          <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--text-muted)]">
            <button type="button" onClick={() => setMode(mode === "register" ? "login" : "register")} className="hover:text-[var(--text-primary)]">
              {mode === "register" ? "Sign in" : "Create account"}
            </button>
            <button type="button" onClick={() => setMode("forgot")} className="hover:text-[var(--text-primary)]">
              Reset access
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

async function firstRunRoute(): Promise<string> {
  try {
    const [preferencesResponse, resumeReady] = await Promise.all([
      preferencesAPI.get().catch(() => ({ data: {} })),
      resumeAPI.getParsed().then(() => true).catch(() => false),
    ]);
    const preferences = preferencesResponse.data || {};
    const hasPreferences = ["skills", "job_titles", "locations", "work_type"].some((key) => {
      const value = preferences[key];
      return Array.isArray(value) && value.length > 0;
    });
    return resumeReady && hasPreferences ? "/dashboard" : "/onboarding";
  } catch {
    return "/onboarding";
  }
}
