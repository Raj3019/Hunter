import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Cpu, Eye, EyeOff, Lock, Mail, ShieldCheck, Target, UserRound } from "lucide-react";
import { useToast } from "../components/Toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { apiErrorMessage, authAPI, preferencesAPI, resumeAPI } from "../api/client";
import { setCurrentUserProfile } from "@/lib/session";

type AuthMode = "login" | "register" | "forgot";

export function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>(((location.state as { mode?: AuthMode } | null)?.mode) ?? "login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const toast = useToast();

  const isSignIn = mode === "login";
  const isRegister = mode === "register";
  const activeAuthTab = isRegister ? "register" : "login";
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
      if (isRegister && !agreedTerms) {
        setError("Please accept the Terms & Conditions to create your account.");
        return;
      }

      const response = isRegister ? await authAPI.register(email, password, fullName.trim()) : await authAPI.login(email, password);
      const token = response.data?.access_token;
      if (token) {
        localStorage.setItem("access_token", token);
        setCurrentUserProfile({
          userId: response.data?.user_id,
          email: response.data?.email || email,
          fullName: response.data?.full_name || (isRegister ? fullName.trim() : ""),
        });
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
              <span className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">RESUME-MATCHED SEARCH</span>
              <h2 className="font-sans text-xl font-bold leading-snug tracking-tight text-white">Find and track jobs that fit your resume.</h2>
              <p className="font-sans text-xs leading-relaxed text-zinc-400">
                Hunter scores live roles from Naukri, Foundit and more against your resume, opens the original portal for you to apply, and tracks every application in one place.
              </p>
            </div>

            <div className="relative z-10 space-y-4 pt-10">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-clay" />
                <div>
                  <h4 className="font-sans text-xs font-bold">Assist-only, never a bot</h4>
                  <p className="font-sans text-[10px] text-zinc-400">Hunter opens the original portal listing — you review and submit every application yourself, so your accounts stay safe.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />
                <div>
                  <h4 className="font-sans text-xs font-bold">AI resume matching</h4>
                  <p className="font-sans text-[10px] text-zinc-400">Every role is scored against your resume, and your resume is tailored per job description before you apply.</p>
                </div>
              </div>
            </div>

            <div className="mt-8 font-mono text-[9px] text-zinc-500">HUNTER WEB • ASSIST-ONLY JOB SEARCH</div>
          </div>

          {/* Form panel */}
          <div className="flex flex-col justify-center space-y-5 p-6 sm:p-8 md:col-span-7">
            <div className="relative grid grid-cols-2 gap-1 overflow-hidden rounded-xl border border-zinc-200/60 bg-zinc-50 p-1">
              <motion.span
                aria-hidden="true"
                animate={{ x: activeAuthTab === "register" ? "100%" : "0%" }}
                transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.75 }}
                className="absolute bottom-1 left-1 top-1 w-[calc(50%-0.25rem)] rounded-lg border border-zinc-200/60 bg-white shadow-sm"
              />
              {([
                { key: "login", label: "Sign In" },
                { key: "register", label: "Create Profile" },
              ] as const).map((tab) => {
                // Keep the pill on "Sign In" while in the forgot-password sub-flow.
                const active = activeAuthTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => { setMode(tab.key); setError(""); setMessage(""); }}
                    aria-pressed={active}
                    className={`relative z-10 rounded-lg py-1.5 text-xs font-bold transition-colors duration-200 ${active ? "text-zinc-950" : "text-zinc-500 hover:text-zinc-950"}`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div>
              <h3 className="font-sans text-lg font-bold tracking-tight text-zinc-950">
                {mode === "forgot" ? "Reset access" : isSignIn ? "Welcome back" : "Create your account"}
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
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
                      aria-invalid={Boolean(error)}
                      autoComplete={isRegister ? "new-password" : "current-password"}
                      className={`w-full rounded-lg border py-2 pl-9 pr-10 font-sans text-xs focus:outline-none ${error ? "border-rose-200 bg-rose-50/30 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-950"}`}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              {isRegister && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-zinc-500">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); if (error) setError(""); }}
                      aria-invalid={Boolean(error)}
                      autoComplete="new-password"
                      className={`w-full rounded-lg border py-2 pl-9 pr-10 font-sans text-xs focus:outline-none ${error ? "border-rose-200 bg-rose-50/30 focus:border-rose-400" : "border-zinc-200 focus:border-zinc-950"}`}
                    />
                    <button
                      type="button"
                      aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                      aria-pressed={showConfirmPassword}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setShowConfirmPassword((visible) => !visible)}
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-950 focus:outline-none focus:ring-2 focus:ring-zinc-200"
                    >
                      {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] font-medium text-zinc-400">Use at least 6 characters.</p>
                </div>
              )}

              {isRegister && (
                <label className="flex cursor-pointer items-start gap-2 text-[11px] font-medium leading-relaxed text-zinc-500">
                  <input
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={(e) => { setAgreedTerms(e.target.checked); if (error) setError(""); }}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-zinc-300 text-zinc-950 accent-zinc-950"
                  />
                  <span>
                    I agree to the{" "}
                    <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-bold text-zinc-950 underline underline-offset-2 hover:text-brand-clay">
                      Terms &amp; Conditions
                    </a>
                    , including that Hunter is not responsible if a job-portal account is banned or blocked.
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={loading || (isRegister && !agreedTerms)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-950 bg-zinc-950 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-75"
              >
                {loading ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <span>{mode === "forgot" ? "Send reset link" : isSignIn ? "Sign In" : "Create Profile"}</span>
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
        Hunter • Assist-only job search
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
