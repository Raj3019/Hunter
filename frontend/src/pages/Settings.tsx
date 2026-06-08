import { AlertTriangle, CheckCircle, FileText, ShieldCheck, User, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusPill } from "../components/StatusPill";
import { useToast } from "../components/Toast";
import { apiErrorMessage, preferencesAPI, resumeAPI } from "../api/client";
import { joinList, splitList } from "../api/mappers";

const tabs = ["Preferences", "Apply Safety", "Resume", "Account"] as const;
type SettingsTab = (typeof tabs)[number];

export function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("Preferences");
  const toast = useToast();
  const [preferences, setPreferences] = useState({
    skills: "React, TypeScript, Python, FastAPI",
    jobTitles: "Frontend Engineer, React Developer",
    locations: "Bengaluru, Pune, Remote India",
    workType: "Hybrid, Remote",
    salary: "15-28 LPA",
    experience: "3-5 years",
    avoid: "Night shifts, unpaid tests",
  });
  const [safeApply, setSafeApply] = useState({ start: "09:00", end: "20:00", dailyLimit: 10, minScore: 75, autoEnabled: false });
  const [allowedPortals, setAllowedPortals] = useState<string[]>([]);
  const [resumeVersion, setResumeVersion] = useState("");
  const [resumeLoaded, setResumeLoaded] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const [preferencesResponse, resumeResponse] = await Promise.allSettled([
          preferencesAPI.get(),
          resumeAPI.getParsed(),
        ]);

        if (preferencesResponse.status === "fulfilled") {
          const data = preferencesResponse.value.data || {};
          setPreferences({
            skills: joinList(data.skills),
            jobTitles: joinList(data.job_titles),
            locations: joinList(data.locations),
            workType: joinList(data.work_type),
            salary: salaryText(data.min_salary, data.max_salary),
            experience: data.experience_years ? `${data.experience_years}` : "",
            avoid: joinList(data.avoid_companies),
          });
          setSafeApply({
            start: timeText(data.safe_apply_start_time, "09:00"),
            end: timeText(data.safe_apply_end_time, "20:00"),
            dailyLimit: Number(data.auto_apply_daily_limit || 10),
            minScore: Number(data.auto_apply_min_score || 75),
            autoEnabled: Boolean(data.auto_apply_enabled),
          });
          setAllowedPortals(Array.isArray(data.auto_apply_allowed_portals) ? data.auto_apply_allowed_portals : []);
        }

        if (resumeResponse.status === "fulfilled") {
          setResumeLoaded(true);
          setResumeVersion(`Uploaded resume - ${resumeResponse.value.data?.created_at ? new Date(resumeResponse.value.data.created_at).toLocaleDateString("en-IN") : "active"}`);
        }
      } catch (caught) {
        toast.error(apiErrorMessage(caught, "Could not load settings."));
      }
    }

    void loadSettings();
  }, []);

  const updatePreference = (key: keyof typeof preferences, value: string) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const savePreferences = async () => {
    try {
      await preferencesAPI.save({
        skills: splitList(preferences.skills),
        job_titles: splitList(preferences.jobTitles),
        locations: splitList(preferences.locations),
        work_type: splitList(preferences.workType),
        min_salary: parseNumber(preferences.salary, 0),
        max_salary: parseNumber(preferences.salary, 1),
        experience_years: Number(preferences.experience || 0),
        avoid_companies: splitList(preferences.avoid),
        apply_mode: "manual",
        auto_apply_enabled: false,
        auto_apply_daily_limit: safeApply.dailyLimit,
        auto_apply_min_score: safeApply.minScore,
        auto_apply_allowed_portals: allowedPortals,
        safe_apply_start_time: safeApply.start,
        safe_apply_end_time: safeApply.end,
        require_tailored_resume_approval: true,
      });
      toast.success("Preferences saved.");
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not save preferences."));
    }
  };

  return (
    <>
      <section className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Manage matching preferences, apply checks, resume state, and backend-only AI configuration.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill label="Preferences saved" tone="success" />
            <StatusPill label="Apply checks active" tone="success" />
            <StatusPill label="Secrets hidden" tone="accent" />
          </div>
        </div>
      </section>

      <nav className="mb-4 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1 scrollbar-thin">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${activeTab === tab ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      <section className="air-surface rounded-lg p-5">
        {activeTab === "Preferences" && (
          <>
            <SectionHeader title="Preferences" body="These values drive job fetching. Hunter then scores each fetched job against your resume." />
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[
                ["skills", "Skills"],
                ["jobTitles", "Job titles"],
                ["locations", "Locations"],
                ["workType", "Work type"],
                ["salary", "Salary"],
                ["experience", "Experience"],
                ["avoid", "Avoid list"],
              ].map(([key, label]) => (
                <label key={key} className="text-sm">
                  {label}
                  <input
                    className="terminal-field mt-1 h-10 w-full rounded-md px-3"
                    value={preferences[key as keyof typeof preferences]}
                    onChange={(event) => updatePreference(key as keyof typeof preferences, event.target.value)}
                  />
                </label>
              ))}
            </div>
            <button type="button" onClick={savePreferences} className="air-button mt-5 h-10 bg-[var(--accent-primary)] px-4 text-white">
              Save preferences
            </button>
          </>
        )}

        {activeTab === "Apply Safety" && (
          <>
            <SectionHeader title="Portal Safety" body="Hunter opens original portal pages and records pending tasks. Auto-submit stays disabled for the MVP." />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Info icon={ShieldCheck} label="Submission" value="You complete it on the portal" tone="success" />
              <Info icon={CheckCircle} label="Tracker" value="Pending until you confirm" tone="success" />
              <Info icon={AlertTriangle} label="Auto-submit" value="Dormant until verified official/native flows exist" tone="warning" />
            </div>
            <button type="button" onClick={savePreferences} className="air-button mt-5 h-10 bg-[var(--accent-primary)] px-4 text-white">
              Save portal workflow
            </button>
          </>
        )}

        {activeTab === "Resume" && (
          <>
            <SectionHeader title="Resume" body="The active resume powers parsing, matching, tailoring, and application Q&A." />
            <div className="mt-5 grid gap-4 md:grid-cols-[1fr_260px]">
              <label className="text-sm">Active resume version
                <input value={resumeLoaded ? resumeVersion : "No resume uploaded yet"} readOnly className="terminal-field mt-1 h-10 w-full rounded-md px-3 text-[var(--text-muted)]" />
              </label>
              <Info icon={FileText} label="Parse status" value={resumeLoaded ? "Parsed and active" : "No resume uploaded"} tone={resumeLoaded ? "success" : "warning"} />
            </div>
          </>
        )}

        {activeTab === "Account" && (
          <>
            <SectionHeader title="Account" body="Session and account controls for the current Hunter workspace." />
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Info icon={User} label="Session" value="JWT auth through Supabase in production" />
              <Info icon={CheckCircle} label="Workspace" value="Hunter automation suite" tone="success" />
              <Info icon={ShieldCheck} label="Secrets" value="Passwords and tokens hidden" tone="success" />
            </div>
          </>
        )}
      </section>
    </>
  );
}

function parseNumber(value: string, index: number): number {
  const numbers = value.match(/\d+/g)?.map(Number) || [];
  const picked = numbers[index] || numbers[0] || 0;
  return value.toLowerCase().includes("lpa") ? picked * 100000 : picked;
}

function salaryText(minSalary: unknown, maxSalary: unknown): string {
  const min = Number(minSalary || 0);
  const max = Number(maxSalary || 0);
  if (!min && !max) return "";
  if (min >= 100000 || max >= 100000) return `${Math.round(min / 100000)}-${Math.round(max / 100000)} LPA`;
  return [min, max].filter(Boolean).join("-");
}

function timeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value.slice(0, 5) : fallback;
}

function SectionHeader({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{body}</p>
    </div>
  );
}

function Info({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] p-3">
      <Icon size={17} style={{ color: tone === "success" ? "var(--state-success)" : tone === "warning" ? "var(--state-warning)" : "var(--text-muted)" }} />
      <p className="mt-2 text-sm font-medium">{label}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{value}</p>
    </div>
  );
}
