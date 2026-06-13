import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { ArrowRight, Check, CheckCircle2, FileUp, Save, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage, preferencesAPI, resumeAPI } from "../api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "../components/ui/spinner";
import { splitList } from "../api/mappers";

const steps = ["Resume", "Preferences", "Portals", "Review"];
const portalOptions = ["Naukri", "Foundit", "Internshala", "TCS", "Infosys"];

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [parseState, setParseState] = useState<"empty" | "parsing" | "success" | "failed">("empty");
  const [parsedResume, setParsedResume] = useState<Record<string, unknown> | null>(null);
  const [preferences, setPreferences] = useState({
    skills: "",
    titles: "",
    locations: "",
    workType: "",
    salary: "",
    experience: "",
    avoid: "",
  });
  const [selectedPortals, setSelectedPortals] = useState(["Naukri", "Foundit", "Internshala"]);
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
        const parsed = response.data?.parsed || null;
        setParsedResume(parsed);
        prefillFromResume(parsed);
        setParseState("success");
      } catch (caught) {
        setParseState("failed");
        setMessage(apiErrorMessage(caught, "Resume upload or parsing failed."));
      }
    },
  });

  const prefillFromResume = (parsed: Record<string, unknown> | null) => {
    if (!parsed) return;
    const derived = {
      skills: listFromResume(parsed, ["skills", "key_skills", "technical_skills"]),
      titles: textFromResume(parsed, ["current_role", "title", "designation", "current_title", "role"]),
      locations: textFromResume(parsed, ["location", "preferred_location", "city", "current_location"]),
      experience: textFromResume(parsed, ["total_experience_years", "experience_years", "years_of_experience"]),
    };
    setPreferences((current) => ({
      ...current,
      skills: current.skills || derived.skills,
      titles: current.titles || derived.titles,
      locations: current.locations || derived.locations,
      experience: current.experience || derived.experience,
    }));
  };

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
        skills: splitList(preferences.skills),
        job_titles: splitList(preferences.titles),
        locations: splitList(preferences.locations),
        work_type: splitList(preferences.workType),
        min_salary: parseSalary(preferences.salary, 0),
        max_salary: parseSalary(preferences.salary, 1),
        experience_years: parseExperience(preferences.experience),
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
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Header */}
      <div className="v0-card rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-brand-border bg-brand-chalk px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-clay">First-run setup</span>
          <span className="rounded border border-brand-border bg-brand-chalk px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-pine">{selectedPortals.length} portals selected</span>
        </div>
        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-display text-2xl font-black tracking-tight text-brand-pine">Resume & Preferences</h1>
            <p className="mt-2 text-sm text-brand-sand">Set up resume context, matching rules, portal connections, and the confirmation workflow Hunter uses after opening portal jobs.</p>
          </div>
          <button type="button" onClick={() => navigate("/dashboard")} className="rounded-xl border border-brand-border px-3 py-2 text-sm font-medium text-brand-sand transition-colors hover:border-brand-pine hover:text-brand-pine">
            Skip for now
          </button>
        </div>
        {message && parseState !== "failed" && (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Setup needs attention</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Stepper */}
      <div className="v0-card rounded-2xl p-3">
        <div className="flex items-center">
          {steps.map((label, index) => {
            const done = index < step;
            const active = index === step;
            return (
              <div key={label} className="flex flex-1 items-center">
                <button type="button" onClick={() => setStep(index)} className="flex items-center gap-2.5">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-xl font-mono text-xs font-bold transition-all ${active ? "bg-brand-pine text-white" : done ? "bg-brand-chalk text-brand-pine" : "border border-brand-border text-zinc-400"}`}>
                    {done ? <Check className="h-4 w-4" /> : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={`hidden text-xs font-bold sm:block ${active || done ? "text-brand-pine" : "text-zinc-400"}`}>{label}</span>
                </button>
                {index < steps.length - 1 && <span className={`mx-3 h-px flex-1 ${done ? "bg-brand-pine/40" : "bg-brand-border"}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <section className="v0-card rounded-2xl p-6">
        {step === 0 && (
          <>
            <h2 className="font-display text-lg font-extrabold text-brand-pine">Upload resume</h2>
            <p className="mt-1 text-sm text-brand-sand">This drives parsing, job scoring, tailoring, and application Q&A.</p>
            <div className="mt-4">
              <div {...getRootProps()} className={`cursor-pointer rounded-2xl border border-dashed p-8 text-center transition-colors ${isDragActive ? "border-brand-clay bg-brand-chalk/60" : "border-brand-border bg-brand-chalk/30 hover:border-brand-pine"}`}>
                <input {...getInputProps()} />
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-pine text-white">
                  <FileUp className="h-5 w-5 text-brand-clay" />
                </div>
                <h3 className="mt-3 text-base font-bold text-brand-pine">Drag & drop your CV</h3>
                <p className="mt-1 text-sm text-brand-sand">Drop a text-based PDF or click to choose one.</p>
              </div>

              <div className="mt-4 rounded-2xl border border-brand-border bg-brand-chalk/40 p-4">
                {parseState === "empty" && <p className="text-sm text-brand-sand">No resume uploaded yet.</p>}
                {parseState === "parsing" && (
                  <p className="flex items-center gap-2 text-sm text-brand-sand"><Spinner className="size-4 text-brand-clay" /> Extracting technical nodes…</p>
                )}
                {parseState === "failed" && (
                  <Alert variant="destructive">
                    <AlertTitle>Resume could not be parsed</AlertTitle>
                    <AlertDescription>{message || "Try a text-based PDF and upload again."}</AlertDescription>
                  </Alert>
                )}
                {parseState === "success" && (
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-brand-pine"><CheckCircle2 size={16} style={{ color: "var(--state-success)" }} /> Parsed resume preview</p>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">Name</dt><dd className="text-brand-pine">{resumeText(parsedResume, "name", "Parsed candidate")}</dd></div>
                      <div><dt className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">Experience</dt><dd className="text-brand-pine">{resumeText(parsedResume, "experience_years", "Parsed")}</dd></div>
                      <div><dt className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">Skills</dt><dd className="text-brand-pine">{resumeList(parsedResume, "skills") || "Skills parsed"}</dd></div>
                      <div><dt className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">Location</dt><dd className="text-brand-pine">{resumeText(parsedResume, "location", "Not specified")}</dd></div>
                    </dl>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="font-display text-lg font-extrabold text-brand-pine">Job preferences</h2>
            <p className="mt-1 text-sm text-brand-sand">These values feed job fetching. Your resume still powers the match score and skill gaps.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {[
                ["skills", "Skills"],
                ["titles", "Job titles"],
                ["locations", "Locations"],
                ["workType", "Work type"],
                ["salary", "Salary"],
                ["experience", "Experience years"],
                ["avoid", "Avoid list"],
              ].map(([key, label]) => (
                <label key={key} className="text-sm">
                  <span className="mb-1 block text-xs font-bold text-zinc-500">{label}</span>
                  <input
                    className="h-10 w-full rounded-xl border border-brand-border bg-brand-chalk/40 px-3 text-sm focus:border-brand-pine focus:outline-none"
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
            <h2 className="font-display text-lg font-extrabold text-brand-pine">Portal connections</h2>
            <p className="mt-1 text-sm text-brand-sand">Choose the portals you want visible in setup. Token and credential entry lives in the Portals page.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {portalOptions.map((portal, index) => {
                const selected = selectedPortals.includes(portal);
                return (
                  <button
                    key={portal}
                    type="button"
                    onClick={() => togglePortal(portal)}
                    className={`rounded-2xl border p-4 text-left text-sm transition-all ${selected ? "border-brand-pine bg-brand-pine text-white shadow-sm" : "border-brand-border bg-white text-brand-pine hover:border-brand-pine"}`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-bold">{portal}</span>
                      {selected && <Check size={16} className="text-brand-clay" />}
                    </span>
                    <span className={`mt-2 block text-xs ${selected ? "text-zinc-300" : "text-brand-sand"}`}>{index < 2 ? "Token based board" : index < 4 ? "Browser session" : "Company account"}</span>
                  </button>
                );
              })}
            </div>
            <Alert variant="warning" className="mt-3">
              <AlertTitle>Portal setup can wait</AlertTitle>
              <AlertDescription>Missing portal setup is visible but does not block entering the dashboard.</AlertDescription>
            </Alert>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="font-display text-lg font-extrabold text-brand-pine">Review setup</h2>
            <p className="mt-1 text-sm text-brand-sand">Confirm Hunter can score jobs, tailor resumes, and apply only after your approval.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <SummaryRow ok={parseState === "success"} label="Resume" value={parseState === "success" ? `Parsed — ${resumeList(parsedResume, "skills").split(",").filter(Boolean).length || "skills"} skills extracted` : "Pending upload"} />
              <SummaryRow ok={Boolean(preferences.titles)} label="Targets" value={preferences.titles || "No target titles set"} />
              <SummaryRow ok={Boolean(preferences.locations)} label="Locations" value={preferences.locations || "No locations set"} />
              <SummaryRow ok={selectedPortals.length > 0} label="Portals" value={selectedPortals.join(", ") || "None selected"} />
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-brand-border bg-brand-chalk/40 p-4 text-sm text-brand-sand">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-brand-clay" />
              Manual-confirm only: fetched jobs are scored, then Hunter opens the original portal and waits for your confirmation.
            </div>
          </>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} className="rounded-xl border border-brand-border px-4 py-2 text-sm font-medium text-brand-sand transition-colors hover:border-brand-pine hover:text-brand-pine">
              Back
            </button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" onClick={nextStep} className="v0-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm">
              Continue
              <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" onClick={saveSetup} className="v0-btn-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm">
              <Save size={15} />
              Enter workspace
            </button>
          )}
          <button type="button" onClick={() => navigate("/portals")} className="rounded-xl border border-brand-border px-4 py-2 text-sm text-brand-sand transition-colors hover:border-brand-pine hover:text-brand-pine">
            Manage portals
          </button>
        </div>
      </section>
    </div>
  );
}

function textFromResume(resume: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = resume[key];
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function listFromResume(resume: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = resume[key];
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item).trim()).filter(Boolean).join(", ");
      if (joined) return joined;
    }
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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

function SummaryRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-brand-border bg-brand-chalk/40 p-3">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? "bg-[var(--state-success)] text-white" : "bg-zinc-200 text-zinc-500"}`}>
        <Check className="h-3 w-3" />
      </span>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="truncate text-sm font-medium text-brand-pine">{value}</p>
      </div>
    </div>
  );
}
