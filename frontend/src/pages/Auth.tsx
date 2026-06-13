import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Cpu, Lock, Mail, ShieldCheck, Target, UserRound } from "lucide-react";
import { useToast } from "../components/Toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { apiErrorMessage, authAPI, preferencesAPI, resumeAPI } from "../api/client";

type AuthMode = "login" | "register" | "forgot";

export function Auth() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const isSignIn = mode === "login";
  const isRegister = mode === "register";
  const authFeedback = error ? authErrorCopy(error, mode) : null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "forgot") {
        setError("Reset link delivery needs the backend email provider to be configured.");
        return;
      }
      if (!email || !password) {
        setError("Please fill in email and password.");
        return;
      }
      if (isRegister && !fullName.trim()) {
        setError("Please enter your full name.");
        return;
      }
      if (isRegister && password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (isRegister && password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      const response = isRegister ? await authAPI.register(email, password, fullName.trim()) : await authAPI.login(email, password);
      const token = response.data?.access_token;
      if (token) {
        localStorage.setItem("access_token", token);
        toast.success(mode === "register" ? "Account created. Welcome to Hunter!" : "Signed in.");
        const target = (location.state as { from?: string } | null)?.from;
        navigate(target || (await firstRunRoute()), { replace: true });
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
    <div className="flex min-h-screen flex-col justify-between bg-brand-linen font-sans text-[#1c1c1e] selection:bg-brand-chalk">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b border-brand-border bg-white px-4 sm:px-6">
        <button type="button" onClick={() => navigate("/")} className="flex cursor-pointer items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-950 text-white shadow-sm">
            <Target className="h-3.5 w-3.5 text-brand-clay" />
          </div>
          <span className="text-sm font-bold text-zinc-950">Hunter</span>
        </button>
        <button type="button" onClick={() => navigate("/")} className="flex items-center gap-1 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </button>
      </header>

      {/* Card */}
      <main className="my-6 flex flex-1 items-center justify-center p-4 sm:p-6">
        <div className="grid min-h-[500px] w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-md md:grid-cols-12">
          {/* Side info panel */}
          <div className="relative flex flex-col justify-between overflow-hidden bg-zinc-950 p-8 text-white md:col-span-5">
            <div className="absolute bottom-0 right-0 h-36 w-36 rounded-full bg-brand-clay/10 blur-[64px]" />
            <div className="absolute left-0 top-0 h-24 w-24 rounded-full bg-zinc-800/10 blur-[48px]" />

            <div className="relative z-10 space-y-4">
              <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">SCORING PIPELINE</span>
              <h2 className="font-sans text-xl font-bold leading-snug tracking-tight text-white">The premium recruiter filter for builders.</h2>
              <p className="font-sans text-xs leading-relaxed text-zinc-400">
                Get parsed intelligence reports instantly. Filter matches by key skill blocks, track scheduled interviews, and skip low-budget spam recruiters forever.
              </p>
            </div>

            <div className="relative z-10 space-y-4 pt-10">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-clay" />
                <div>
                  <h4 className="font-sans text-xs font-bold">Strict portal integrity</h4>
                  <p className="font-sans text-[10px] text-zinc-400">Hunter opens the original portal window securely; your direct logins stay safe.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <div>
                  <h4 className="font-sans text-xs font-bold">Structured AI analyses</h4>
                  <p className="font-sans text-[10px] text-zinc-400">Enrich, rank, and tailor resume copies dynamically against each job description.</p>
                </div>
              </div>
            </div>

            <div className="mt-8 font-mono text-[9px] text-zinc-500">HUNTER WEB • JOB AUTOMATION SUITE</div>
          </div>

          {/* Form panel */}
          <div className="flex flex-col justify-center space-y-5 p-6 sm:p-8 md:col-span-7">
            <div className="flex items-center justify-between rounded-xl border border-zinc-200/60 bg-zinc-50 p-1">
              <button
                type="button"
                onClick={() => { setMode("login"); setError(""); setMessage(""); }}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${isSignIn ? "border border-zinc-200/50 bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setMode("register"); setError(""); setMessage(""); }}
                className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all ${mode === "register" ? "border border-zinc-200/50 bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-950"}`}
              >
                Create Profile
              </button>
            </div>

            <div>
              <h3 className="font-sans text-lg font-bold tracking-tight text-zinc-950">
                {mode === "forgot" ? "Reset access" : isSignIn ? "Welcome back" : "Create developer index"}
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                {mode === "forgot"
                  ? "Enter your email and we'll send reset instructions."
                  : isSignIn
                    ? "Provide your credentials to continue to your workspace."
                    : "Add your account details, then continue into your Hunter workspace."}
              </p>
            </div>

            {message && (
              <Alert variant="info" className="text-xs">
                <AlertTitle>Account notice</AlertTitle>
                <AlertDescription className="text-xs">{message}</AlertDescription>
              </Alert>
            )}
            {authFeedback && (
              <Alert variant="destructive" className="text-xs">
                <AlertTitle>{authFeedback.title}</AlertTitle>
                <AlertDescription className="text-xs">{authFeedback.description}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={submit} className="space-y-3.5">
              {isRegister && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500">Full Name</label>
                  <div className="relative">
                    <UserRound className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                    <input
                      type="text"
                      required
                      placeholder="Raj Chauhan"
                      value={fullName}
                      onChange={(e) => { setFullName(e.target.value); if (error) setError(""); }}
                      aria-invalid={Boolean(error)}
                      autoComplete="name"
                      className={`w-full rounded-lg border py-2 pl-9 pr-3 font-sans text-xs focus:outline-none ${error ? "border-rose-200 bg-rose-50/30 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-950"}`}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-zinc-500">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                  <input
                    type="email"
                    required
                    placeholder="you@domain.com"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }}
                    aria-invalid={Boolean(error)}
                    autoComplete="email"
                    className={`w-full rounded-lg border py-2 pl-9 pr-3 font-sans text-xs focus:outline-none ${error ? "border-rose-200 bg-rose-50/30 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-950"}`}
                  />
                </div>
              </div>

              {mode !== "forgot" && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-500">Password</label>
                    {isSignIn && (
                      <button type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }} className="text-[10px] text-zinc-500 hover:text-zinc-950">
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
                      aria-invalid={Boolean(error)}
                      autoComplete={isRegister ? "new-password" : "current-password"}
                      className={`w-full rounded-lg border py-2 pl-9 pr-3 font-sans text-xs focus:outline-none ${error ? "border-rose-200 bg-rose-50/30 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-950"}`}
                    />
                  </div>
                </div>
              )}

              {isRegister && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(""); }}
                      aria-invalid={Boolean(error)}
                      autoComplete="new-password"
                      className={`w-full rounded-lg border py-2 pl-9 pr-3 font-sans text-xs focus:outline-none ${error ? "border-rose-200 bg-rose-50/30 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-950"}`}
                    />
                  </div>
                  <p className="text-[10px] font-medium text-zinc-400">Use at least 6 characters.</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-950 bg-zinc-950 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-zinc-900 disabled:opacity-75"
              >
                {loading ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <span>{mode === "forgot" ? "Send reset link" : isSignIn ? "Check Credentials" : "Register Profile"}</span>
                )}
                {!loading && <ArrowRight className="h-3.5 w-3.5 text-brand-clay" />}
              </button>
            </form>

            {mode === "forgot" && (
              <button type="button" onClick={() => { setMode("login"); setError(""); }} className="text-center text-xs font-semibold text-zinc-500 hover:text-zinc-950">
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </main>

      <footer className="flex h-10 items-center justify-center border-t border-brand-border bg-white font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
        Hunter • Direct portal aggregator
      </footer>
    </div>
  );
}

function authErrorCopy(error: string, mode: AuthMode): { title: string; description: string } {
  const normalized = error.toLowerCase();
  if (normalized.includes("invalid login credentials") || normalized.includes("invalid credentials")) {
    return {
      title: "Credentials did not match",
      description: "Check the email and password, then try again.",
    };
  }
  if (normalized.includes("fill in email and password")) {
    return {
      title: "Email and password required",
      description: "Enter both fields before continuing.",
    };
  }
  if (normalized.includes("full name")) {
    return {
      title: "Profile name required",
      description: "Enter your name so Hunter can personalize your workspace.",
    };
  }
  if (normalized.includes("at least 6")) {
    return {
      title: "Password is too short",
      description: "Use at least 6 characters for your account password.",
    };
  }
  if (normalized.includes("passwords do not match")) {
    return {
      title: "Passwords do not match",
      description: "Re-enter the confirmation password so both fields are identical.",
    };
  }
  if (mode === "forgot") {
    return {
      title: "Reset link unavailable",
      description: error,
    };
  }
  return {
    title: mode === "register" ? "Could not create profile" : "Could not sign in",
    description: error,
  };
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
