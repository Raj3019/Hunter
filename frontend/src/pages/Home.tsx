import { ArrowRight, BriefcaseBusiness, CheckCircle, Gauge, ShieldCheck, Sparkles } from "lucide-react";
import { Navigate, Link } from "react-router-dom";
import { BrandMark } from "../components/BrandMark";
import { StatusPill } from "../components/StatusPill";

export function Home() {
  if (localStorage.getItem("access_token")) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="flex h-20 items-center justify-between border-b border-[var(--border-default)] bg-[var(--bg-surface)]/90 px-4 backdrop-blur lg:px-8">
        <BrandMark />
        <div className="flex items-center gap-2">
          <Link to="/auth" className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm">
            Sign in
          </Link>
          <Link to="/auth" className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm font-medium text-white">
            Get started
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
        <div className="desk-panel overflow-hidden rounded-xl">
          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_430px] lg:p-8">
            <div>
              <div className="flex flex-wrap gap-2">
                <StatusPill label="AI match review" tone="accent" />
                <StatusPill label="Apply checks built in" tone="success" />
              </div>
              <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">A polished workspace for job applications</h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--text-muted)]">
                Search Indian portals, score jobs against your resume, tailor each application, apply after a quick safety check, and track the full pipeline.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link to="/auth" className="inline-flex items-center gap-2 rounded-md bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-white">
                  Get started
                  <ArrowRight size={15} />
                </Link>
                <Link to="/auth" className="rounded-md border border-[var(--border-default)] bg-[var(--bg-base)] px-4 py-2 text-sm font-medium">
                  Sign in
                </Link>
              </div>
            </div>
            <div className="desk-subpanel rounded-xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Live preview</p>
                <Sparkles size={18} className="text-[var(--accent-primary)]" />
              </div>
              <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Frontend Engineer</p>
                    <p className="text-xs text-[var(--text-muted)]">PhonePe - Bengaluru - Greenhouse</p>
                  </div>
                  <span className="rounded border px-2 py-1 font-mono text-xs" style={{ color: "var(--score-high)", borderColor: "var(--score-high)" }}>
                    91
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  {["React", "TypeScript", "Playwright"].map((skill) => (
                    <span key={skill} className="rounded px-2 py-1 text-center" style={{ color: "var(--state-success)", background: "color-mix(in srgb, var(--state-success) 14%, transparent)" }}>
                      {skill}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm text-white">Approve</button>
                  <button className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm">Tailor</button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-5 gap-1 text-center text-xs text-[var(--text-muted)]">
                {["Resume", "Prefs", "Portals", "Review", "Apply"].map((step, index) => (
                  <div key={step}>
                    <div className={`mb-2 h-1.5 rounded-full ${index < 4 ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-elevated)]"}`} />
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {[
            { icon: BriefcaseBusiness, title: "Connected", body: "Naukri, Foundit, LinkedIn, Greenhouse, Workday, and company portals." },
            { icon: ShieldCheck, title: "Apply safety", body: "Checks sessions, duplicates, limits, and apply hours before submitting." },
            { icon: Gauge, title: "Tracker", body: "Fetched, approved, applied, interview, rejected, and archived states." },
          ].map((item) => (
            <div key={item.title} className="desk-panel rounded-lg p-4">
              <item.icon size={20} className="text-[var(--accent-primary)]" />
              <h2 className="mt-3 text-sm font-semibold">{item.title}</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{item.body}</p>
            </div>
          ))}
        </div>

        <div className="desk-panel mt-8 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Workflow</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {["Resume", "Preferences", "Portal connect", "Review", "Apply"].map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded border border-[var(--border-default)] px-2 py-1">{step}</span>
                {index < 4 && <ArrowRight size={14} className="text-[var(--text-muted)]" />}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Frontend Engineer</p>
                <p className="text-xs text-[var(--text-muted)]">PhonePe - Bengaluru - Greenhouse</p>
              </div>
              <span className="rounded border px-2 py-1 text-xs" style={{ color: "var(--score-high)", borderColor: "var(--score-high)" }}>
                91%
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {["React", "TypeScript", "Playwright"].map((skill) => (
                <span key={skill} className="rounded px-2 py-1 text-xs" style={{ color: "var(--state-success)", background: "color-mix(in srgb, var(--state-success) 14%, transparent)" }}>
                  {skill}
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm text-white">Approve</button>
              <button className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm">Tailor</button>
              <button className="rounded-md px-3 py-2 text-sm text-[var(--text-muted)]">Skip</button>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
            <p className="text-sm font-semibold">Application stages</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {["Fetched", "Approved", "Applied", "Interview"].map((stage) => (
                <div key={stage} className="flex items-center gap-2 rounded bg-[var(--bg-elevated)] p-2">
                  <CheckCircle size={14} style={{ color: "var(--state-success)" }} />
                  {stage}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
