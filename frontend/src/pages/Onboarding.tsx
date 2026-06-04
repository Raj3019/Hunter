import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { AlertTriangle, ArrowRight, CheckCircle, FileUp, Loader2, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusPill } from "../components/StatusPill";
import { apiErrorMessage, preferencesAPI, resumeAPI } from "../api/client";
import { splitList } from "../api/mappers";

const steps = ["Resume", "Preferences", "Portals", "Review"];
const portalOptions = ["Naukri", "Foundit", "LinkedIn", "Internshala", "TCS", "Infosys"];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [parseState, setParseState] = useState<"empty" | "parsing" | "success" | "failed">("empty");
  const [parsedResume, setParsedResume] = useState<Record<string, unknown> | null>(null);
  const [preferences, setPreferences] = useState({
    titles: "Frontend Engineer, React Developer",
    locations: "Bengaluru, Pune, Remote India",
    workType: "Hybrid, Remote",
    salary: "15-28 LPA",
    experience: "3",
    avoid: "Night shifts, unpaid tests",
  });
  const [selectedPortals, setSelectedPortals] = useState(["Naukri", "Foundit", "LinkedIn"]);
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setParseState("parsing");
      setMessage("");
      try {
        const response = await resumeAPI.upload(file);
        setParsedResume(response.data?.parsed || null);
        setParseState("success");
      } catch (caught) {
        setParseState("failed");
        setMessage(apiErrorMessage(caught, "Resume upload or parsing failed."));
      }
    },
  });

  const togglePortal = (portal: string) => {
    setSelectedPortals((current) =>
      current.includes(portal) ? current.filter((item) => item !== portal) : [...current, portal]
    );
  };

  const nextStep = () => setStep((current) => Math.min(current + 1, steps.length - 1));

  const saveSetup = async () => {
    setMessage("");
    try {
      await preferencesAPI.save({
        job_titles: splitList(preferences.titles),
        locations: splitList(preferences.locations),
        work_type: splitList(preferences.workType),
        min_salary: parseSalary(preferences.salary, 0),
        max_salary: parseSalary(preferences.salary, 1),
        experience_years: parseExperience(preferences.experience || preferences.salary),
        avoid_companies: splitList(preferences.avoid),
        apply_mode: "manual",
        auto_apply_enabled: false,
        auto_apply_daily_limit: 10,
        auto_apply_min_score: 75,
        auto_apply_allowed_portals: selectedPortals.map((portal) => portal.toLowerCase()),
        safe_apply_start_time: "09:00",
        safe_apply_end_time: "20:00",
        require_tailored_resume_approval: true,
      });
      navigate("/dashboard");
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not save setup."));
    }
  };

  return (
    <>
      <div className="desk-panel mb-5 rounded-xl p-5">
        <div className="flex flex-wrap gap-2">
          <StatusPill label="Setup required" tone="warning" />
          <StatusPill label={`${selectedPortals.length} portals selected`} tone="accent" />
        </div>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Resume & Preferences</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">Set up resume context, matching rules, portal connections, and the apply checks Hunter runs before submitting.</p>
          </div>
          <button type="button" onClick={() => navigate("/dashboard")} className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]">
            Skip to dashboard
          </button>
        </div>
        {message && <p className="mt-4 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-muted)]">{message}</p>}
      </div>

      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <aside className="desk-panel rounded-lg p-4">
          <p className="text-sm font-medium">Setup checklist</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Use each step to prepare the automation workflow.</p>
          <nav className="mt-4 space-y-2">
          {steps.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => setStep(index)}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                step === index ? "border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)]"
              }`}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded border border-[var(--border-default)] text-xs">{index + 1}</span>
              {label}
            </button>
          ))}
          </nav>
        </aside>

        <section className="desk-panel rounded-lg p-5">
          {step === 0 && (
            <>
              <h2 className="text-lg font-semibold">Upload resume</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">This drives parsing, job scoring, tailoring, and application Q&A.</p>
              <div className="mt-4">
            <div {...getRootProps()} className={`rounded-lg border border-dashed p-6 ${isDragActive ? "border-[var(--accent-primary)]" : "border-[var(--border-default)]"}`}>
              <input {...getInputProps()} />
              <FileUp size={24} className="text-[var(--accent-primary)]" />
              <h2 className="mt-3 text-base font-semibold">Upload resume</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Drop a text-based PDF or click to choose one.</p>
            </div>
            <div className="desk-subpanel mt-4 rounded-lg p-4">
              {parseState === "empty" && <p className="text-sm text-[var(--text-muted)]">No resume uploaded yet.</p>}
              {parseState === "parsing" && (
                <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 size={16} className="animate-spin" />
                  Parsing resume...
                </p>
              )}
              {parseState === "failed" && (
                <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <AlertTriangle size={16} style={{ color: "var(--state-error)" }} />
                  Parse failed. Try a text-based PDF.
                </p>
              )}
              {parseState === "success" && (
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle size={16} style={{ color: "var(--state-success)" }} />
                    Parsed resume preview
                  </p>
                  <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div><dt className="text-[var(--text-muted)]">Name</dt><dd>{resumeText(parsedResume, "name", "Parsed candidate")}</dd></div>
                    <div><dt className="text-[var(--text-muted)]">Experience</dt><dd>{resumeText(parsedResume, "experience_years", "Parsed")}</dd></div>
                    <div><dt className="text-[var(--text-muted)]">Skills</dt><dd>{resumeList(parsedResume, "skills") || "Skills parsed"}</dd></div>
                    <div><dt className="text-[var(--text-muted)]">Location</dt><dd>{resumeText(parsedResume, "location", "Not specified")}</dd></div>
                  </dl>
                </div>
              )}
            </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-lg font-semibold">Job preferences</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">These values feed daily fetch, scoring, and avoid-list checks.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["titles", "Job titles"],
                  ["locations", "Locations"],
                  ["workType", "Work type"],
                  ["salary", "Salary"],
                  ["experience", "Experience years"],
                  ["avoid", "Avoid list"],
                ].map(([key, label]) => (
                  <label key={key} className="text-sm">
                    {label}
                    <input
                      className="terminal-field mt-1 h-10 w-full rounded-lg px-3"
                      value={preferences[key as keyof typeof preferences]}
                      onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-lg font-semibold">Portal connections</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Choose the portals you want visible in setup. Token and credential entry lives in the Portals page.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {portalOptions.map((portal, index) => {
                  const selected = selectedPortals.includes(portal);
                  return (
                    <button
                      key={portal}
                      type="button"
                      onClick={() => togglePortal(portal)}
                      className={`rounded-lg border p-4 text-left text-sm ${
                        selected ? "border-[var(--accent-primary)] bg-[var(--bg-elevated)]" : "border-[var(--border-default)]"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-medium">{portal}</span>
                        {selected && <CheckCircle size={16} style={{ color: "var(--state-success)" }} />}
                      </span>
                      <span className="mt-2 block text-xs text-[var(--text-muted)]">{index < 2 ? "Token based board" : index < 4 ? "Browser session" : "Company account"}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} />
                Missing portal setup is visible but does not block entering the dashboard.
              </p>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-lg font-semibold">Review setup</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Confirm Hunter can score jobs, tailor resumes, and apply only after your approval.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <SummaryCard label="Resume" value={parseState === "success" ? "Parsed" : "Pending"} />
                <SummaryCard label="Job titles" value={preferences.titles} />
                <SummaryCard label="Portals" value={selectedPortals.join(", ") || "None selected"} />
              </div>
              <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-sm text-[var(--text-muted)]">
                Applying remains approval-first: fetched jobs are scored, then you approve before Hunter submits anything.
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {step < steps.length - 1 ? (
              <button type="button" onClick={nextStep} className="inline-flex items-center gap-2 rounded-md bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-white">
                Continue
                <ArrowRight size={15} />
              </button>
            ) : (
              <button type="button" onClick={saveSetup} className="inline-flex items-center gap-2 rounded-md bg-[var(--accent-primary)] px-4 py-2 text-sm font-medium text-white">
                <Save size={15} />
                Save setup
              </button>
            )}
            <button type="button" onClick={() => navigate("/portals")} className="rounded-md border border-[var(--border-default)] px-4 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)]">
              Manage portals
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function parseSalary(value: string, index: number): number {
  const numbers = value.match(/\d+/g)?.map(Number) || [];
  const picked = numbers[index] || numbers[0] || 0;
  return value.toLowerCase().includes("lpa") ? picked * 100000 : picked;
}

function parseExperience(value: string): number {
  return value.match(/\d+/)?.[0] ? Number(value.match(/\d+/)?.[0]) : 0;
}

function resumeText(resume: Record<string, unknown> | null, key: string, fallback: string): string {
  const value = resume?.[key];
  if (typeof value === "number") return `${value}`;
  return typeof value === "string" && value.trim() ? value : fallback;
}

function resumeList(resume: Record<string, unknown> | null, key: string): string {
  const value = resume?.[key];
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 8).join(", ");
  return typeof value === "string" ? value : "";
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="desk-subpanel rounded-lg p-3">
      <p className="text-xs uppercase text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}
