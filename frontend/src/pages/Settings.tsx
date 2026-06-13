import { AlertCircle, Bell, Clock, FileText, Mail, Phone, Plus, RefreshCw, Sliders, SlidersHorizontal, UploadCloud, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useToast } from "../components/Toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusButton } from "@/components/ui/status-button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { usePageLoading } from "@/components/PageLoadingContext";
import { apiErrorMessage, authAPI, preferencesAPI, resumeAPI } from "../api/client";
import { splitList } from "../api/mappers";

type SubTab = "ACCOUNT" | "RESUME" | "PREFERENCES" | "SYNC" | "ALERTS";

const NAV: Array<{ key: SubTab; label: string; icon: typeof FileText }> = [
  { key: "ACCOUNT", label: "Account", icon: UserRound },
  { key: "RESUME", label: "Resume", icon: FileText },
  { key: "PREFERENCES", label: "Preferences", icon: Sliders },
  { key: "SYNC", label: "Sync", icon: RefreshCw },
  { key: "ALERTS", label: "Notifications", icon: Bell },
];

export const SHORTLIST_THRESHOLD_KEY = "hunter_shortlist_threshold";

type UserProfile = {
  name: string;
  email: string;
};

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") return splitList(value);
  return [];
}

export function Settings({ userProfile, onProfileSaved }: { userProfile?: UserProfile; onProfileSaved?: () => void | Promise<unknown> }) {
  const [tab, setTab] = useState<SubTab>("ACCOUNT");
  const toast = useToast();
  const setPageLoading = usePageLoading();

  const [profileName, setProfileName] = useState(userProfile?.name || "");
  const [profileEmail, setProfileEmail] = useState(userProfile?.email || "");
  const [profilePhone, setProfilePhone] = useState("");

  const [titles, setTitles] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [salary, setSalary] = useState("");
  const [experience, setExperience] = useState("");
  const [workType, setWorkType] = useState("");
  const [safeApply, setSafeApply] = useState({ start: "09:00", end: "20:00", dailyLimit: 10, minScore: 75 });
  const [allowedPortals, setAllowedPortals] = useState<string[]>([]);

  const [newTitle, setNewTitle] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newAvoid, setNewAvoid] = useState("");
  // Shortlist threshold is stored locally (separate knob from the Recommend
  // threshold, which lives in preferences as auto_apply_min_score).
  const [shortlistThreshold, setShortlistThreshold] = useState(() => Number(localStorage.getItem(SHORTLIST_THRESHOLD_KEY)) || 60);

  const [resumeMeta, setResumeMeta] = useState<{ filename: string; parsedAt: string; title: string; experience: string; skills: string[] } | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    setProfileName((current) => current || userProfile?.name || "");
    setProfileEmail((current) => current || userProfile?.email || "");
  }, [userProfile?.email, userProfile?.name]);

  const loadResume = (data: Record<string, unknown> | undefined) => {
    if (!data) return;
    // upload route returns { parsed }, /parsed route returns { parsed_data, file_url, created_at }.
    const parsed = ((data.parsed_data ?? data.parsed ?? data) as Record<string, unknown>) || {};
    const exp = parsed.experience_years ?? parsed.total_experience_years ?? parsed.years_of_experience;
    setResumeMeta({
      filename: String(data.filename || parsed.name || parsed.full_name || "Active resume"),
      parsedAt: data.created_at ? new Date(String(data.created_at)).toLocaleDateString("en-IN") : "active",
      title: String(parsed.current_role || parsed.title || parsed.designation || parsed.current_title || parsed.role || "—"),
      experience: exp !== undefined && exp !== null && `${exp}`.trim() ? `${exp}` : "—",
      skills: toArray(parsed.skills || parsed.key_skills || parsed.technical_skills),
    });
  };

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, prefRes, resumeRes] = await Promise.allSettled([authAPI.me(), preferencesAPI.get(), resumeAPI.getParsed()]);
        if (profileRes.status === "fulfilled") {
          const data = profileRes.value.data || {};
          setProfileName(String(data.full_name || ""));
          setProfileEmail(String(data.email || ""));
          setProfilePhone(String(data.phone || ""));
        }
        if (prefRes.status === "fulfilled") {
          const data = prefRes.value.data || {};
          setTitles(toArray(data.job_titles));
          setSkills(toArray(data.skills));
          setLocations(toArray(data.locations));
          setAvoid(toArray(data.avoid_companies));
          setWorkType(toArray(data.work_type).join(", "));
          setSalary(salaryText(data.min_salary, data.max_salary));
          setExperience(data.experience_years ? `${data.experience_years}` : "");
          setSafeApply({
            start: timeText(data.safe_apply_start_time, "09:00"),
            end: timeText(data.safe_apply_end_time, "20:00"),
            dailyLimit: Number(data.auto_apply_daily_limit || 10),
            minScore: Number(data.auto_apply_min_score || 60),
          });
          setAllowedPortals(Array.isArray(data.auto_apply_allowed_portals) ? data.auto_apply_allowed_portals : []);
        }
        if (resumeRes.status === "fulfilled") loadResume(resumeRes.value.data);
      } finally {
        setSettingsLoading(false);
      }
    }
    void load();
  }, []);

  useLayoutEffect(() => {
    if (!settingsLoading) {
      setPageLoading(null);
      return;
    }
    setPageLoading({
      title: "Loading settings...",
      description: "Fetching your account profile, preferences, and resume.",
    });
    return () => setPageLoading(null);
  }, [settingsLoading, setPageLoading]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
    onDrop: async (files) => {
      const file = files[0];
      if (!file) return;
      setUploading(true);
      setUploadProgress(8);
      try {
        const response = await resumeAPI.upload(file, (event) => {
          if (!event.total) {
            setUploadProgress((current) => Math.max(current, 35));
            return;
          }
          const uploaded = Math.round((event.loaded / event.total) * 90);
          setUploadProgress(Math.min(95, Math.max(8, uploaded)));
        });
        setUploadProgress(100);
        loadResume(response.data?.parsed ? { parsed: response.data.parsed, created_at: new Date().toISOString(), filename: file.name } : response.data);
        toast.success("Resume parsed successfully.");
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      } catch (caught) {
        toast.error(apiErrorMessage(caught, "Resume upload or parsing failed."));
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    disabled: uploading,
  });

  const savePreferences = async () => {
    if (titles.length === 0 && skills.length === 0 && locations.length === 0) {
      toast.error("Add at least one job title, skill, or location before saving.");
      throw new Error("validation");
    }
    try {
      await preferencesAPI.save({
        skills,
        job_titles: titles,
        locations,
        work_type: splitList(workType),
        min_salary: parseNumber(salary, 0),
        max_salary: parseNumber(salary, 1),
        experience_years: Number(experience || 0),
        avoid_companies: avoid,
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
      throw caught; // surface to the StatusButton for the error animation
    }
  };

  const saveProfile = async () => {
    const fullName = profileName.trim();
    if (!fullName) {
      toast.error("Enter your full name before saving.");
      throw new Error("validation");
    }
    try {
      const response = await authAPI.updateProfile({
        full_name: fullName,
        phone: profilePhone.trim(),
      });
      setProfileName(String(response.data?.full_name || fullName));
      setProfileEmail(String(response.data?.email || profileEmail));
      setProfilePhone(String(response.data?.phone || ""));
      await onProfileSaved?.();
      toast.success("Profile updated.");
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not save profile."));
      throw caught;
    }
  };

  return (
    <div className="grid animate-fade-in-slide items-start gap-6 text-left md:grid-cols-12">
      {/* Left nav */}
      <Card className="space-y-1 rounded-2xl p-3.5 md:col-span-3">
        <span className="block px-3 py-1 font-mono text-[9px] font-extrabold uppercase tracking-wider text-zinc-400">Settings & Sync</span>
        {NAV.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-bold transition-all ${tab === item.key ? "bg-brand-pine text-white shadow-sm" : "text-zinc-600 hover:bg-zinc-50"}`}
          >
            <item.icon className="h-4 w-4 shrink-0" /> {item.label}
          </button>
        ))}
      </Card>

      {/* Content */}
      <Card className="rounded-2xl p-6 sm:p-8 md:col-span-9">
        {tab === "ACCOUNT" && (
          <div className="space-y-6">
            <Header title="Account profile" body="Update the identity Hunter shows in the sidebar, portals, and application context." />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <div className="relative">
                  <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Raj Chauhan" className="h-11 rounded-xl pl-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input value={profileEmail || "Not available"} readOnly className="h-11 rounded-xl bg-zinc-50 pl-9 text-zinc-500" />
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Phone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <Input value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} placeholder="Optional phone for future notifications" className="h-11 rounded-xl pl-9" />
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200/60 bg-zinc-50/60 p-4 text-[11px] font-medium leading-relaxed text-zinc-500">
              The sidebar name and initials update from this profile row, so future database changes and Settings edits stay in sync.
            </div>
            <StatusButton onClick={saveProfile} text={{ loading: "Saving profile...", success: "Profile saved", error: "Couldn't save" }}>
              Save profile
            </StatusButton>
          </div>
        )}

        {tab === "RESUME" && (
          <div className="space-y-6">
            <Header title="Your resume" body="Upload and manage the resume Hunter uses to score and tailor jobs for you." />
            <div className="space-y-3">
              <Label>Upload a new resume (PDF)</Label>
              <div {...getRootProps()} className={`relative cursor-pointer rounded-2xl border border-dashed p-8 text-center transition-all ${uploading ? "cursor-wait border-brand-pine bg-white" : isDragActive ? "border-brand-pine bg-brand-chalk/50" : "border-zinc-300 bg-[#faf7f0] hover:border-zinc-950"}`}>
                <input {...getInputProps()} />
                <div className="mx-auto max-w-sm space-y-3">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white shadow-sm"><UploadCloud className="h-5 w-5 text-zinc-400" /></div>
                  <div className="text-xs"><p className="font-extrabold text-zinc-900">{uploading ? "Uploading resume..." : isDragActive ? "Drop the PDF here" : "Drag and drop your resume here"}</p><p className="mt-1 text-[10px] font-medium text-zinc-400">{uploading ? "Parsing starts as soon as upload completes" : "or click to browse files"}</p></div>
                  {uploading && (
                    <div className="mx-auto max-w-xs space-y-2 pt-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-zinc-700">
                        <span>Upload progress</span>
                        <span className="font-mono">{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-1.5 bg-zinc-200" />
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="grid gap-4 rounded-xl border border-zinc-200/50 bg-zinc-50/50 p-4 md:grid-cols-2">
              <div className="space-y-3 text-left">
                <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-400">Resume details</span>
                <div className="space-y-2 font-sans text-xs font-medium text-zinc-700">
                  <p>📁 File: <span className="font-bold text-zinc-950">{resumeMeta?.filename || "No resume uploaded"}</span></p>
                  <p>📅 Parsed on: <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono font-bold text-zinc-800">{resumeMeta?.parsedAt || "—"}</span></p>
                  <p>💼 Role: <span className="font-bold text-zinc-950">{resumeMeta?.title || "—"}</span></p>
                  <p>⏳ Experience: <span className="font-bold text-zinc-950">{resumeMeta?.experience || "—"}</span></p>
                </div>
              </div>
              <div className="space-y-2.5 text-left">
                <span className="block font-mono text-[8px] font-bold uppercase tracking-wider text-zinc-400">Skills found ({resumeMeta?.skills.length || 0})</span>
                <div className="flex flex-wrap gap-1">{(resumeMeta?.skills || []).map((skill) => <span key={skill} className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-zinc-800">{skill}</span>)}</div>
              </div>
            </div>
          </div>
        )}

        {tab === "PREFERENCES" && (
          <div className="space-y-6">
            <Header title="Job preferences" body="Set the roles and skills you want, and the companies you'd rather not see." />
            <ChipField label="Job titles you want" items={titles} setItems={setTitles} draft={newTitle} setDraft={setNewTitle} placeholder="e.g. Platform Engineer, Frontend Lead" addLabel="Add title" />
            <ChipField label="Skills to prioritise" items={skills} setItems={setSkills} draft={newSkill} setDraft={setNewSkill} placeholder="e.g. Next.js, Redis, MongoDB" addLabel="Add skill" mono />
            <ChipField label="Preferred locations" items={locations} setItems={setLocations} draft={newLocation} setDraft={setNewLocation} placeholder="e.g. Bengaluru, Pune, Remote" addLabel="Add location" />
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label>Work type</Label><Input value={workType} onChange={(e) => setWorkType(e.target.value)} placeholder="Hybrid, Remote" /></div>
              <div className="space-y-1.5"><Label>Salary</Label><Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="15-28 LPA" /></div>
              <div className="space-y-1.5"><Label>Experience (years)</Label><Input value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="3-5" /></div>
            </div>
            <div className="space-y-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4">
              <Label>Recommend jobs scoring at least</Label>
              <div className="flex items-center gap-3.5">
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-extrabold uppercase tracking-wider text-zinc-400"><SlidersHorizontal className="h-4 w-4" /> Min match:</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={safeApply.minScore}
                  onChange={(e) => setSafeApply((s) => ({ ...s, minScore: Number(e.target.value) }))}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-brand-pine"
                />
                <span className="rounded border border-zinc-200/60 bg-white px-2 py-0.5 font-mono text-[11px] font-extrabold text-zinc-800">≥ {safeApply.minScore}%</span>
              </div>
              <p className="text-[11px] text-zinc-400">Jobs at or above this score are flagged <b className="text-zinc-600">Recommended</b>. Lower-scoring jobs are still shown — never hidden.</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/50 p-4">
              <Label>Shortlist jobs scoring at least</Label>
              <div className="flex items-center gap-3.5">
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-extrabold uppercase tracking-wider text-zinc-400"><SlidersHorizontal className="h-4 w-4" /> Min match:</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={shortlistThreshold}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setShortlistThreshold(v);
                    localStorage.setItem(SHORTLIST_THRESHOLD_KEY, String(v));
                  }}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-brand-clay"
                />
                <span className="rounded border border-zinc-200/60 bg-white px-2 py-0.5 font-mono text-[11px] font-extrabold text-zinc-800">≥ {shortlistThreshold}%</span>
              </div>
              <p className="text-[11px] text-zinc-400">Drives the <b className="text-zinc-600">Shortlists</b> count on your Dashboard — jobs scoring at or above this bar. Saved on your device.</p>
            </div>
            <ChipField
              label="Companies to avoid"
              items={avoid}
              setItems={setAvoid}
              draft={newAvoid}
              setDraft={setNewAvoid}
              placeholder="e.g. TCS Consultancies, Outsource Teams"
              addLabel="Ignore target"
              tone="rose"
              badge={<span className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 font-mono text-[9px] font-bold text-rose-800"><AlertCircle className="h-3 w-3" /> Hidden from your matches</span>}
            />
            <StatusButton onClick={savePreferences} text={{ loading: "Saving…", success: "Saved", error: "Couldn't save" }}>Save preferences</StatusButton>
          </div>
        )}

        {tab === "SYNC" && (
          <div className="space-y-6">
            <Header title="Autosync schedule" body="Review how often Hunter refreshes data while the app is open." />
            <div className="grid gap-3 sm:grid-cols-2">
              <SyncTimingCard title="Live matches + Tracker data" interval="Every 60 seconds" body="Refreshes saved job matches and application rows while the tab is visible." />
              <SyncTimingCard title="Portal connection health" interval="Every 10 minutes" body="Checks whether connected portals still look healthy or need a reconnect." />
              <SyncTimingCard title="Applied-status detection" interval="Every 5 minutes" body="Runs portal applied-status sync with a throttle so connected portals are not hit too often." />
              <SyncTimingCard title="Return-to-app refresh" interval="On focus / Tracker open" body="Forces a sync when you come back to the tab or open Tracker after applying externally." />
            </div>
            <div className="flex gap-3 rounded-2xl border border-brand-border bg-[#faf7f0] p-4 text-[11px] font-medium leading-relaxed text-brand-pine">
              <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-brand-clay" />
              <p><b>Pause behavior:</b> autosync pauses while the browser tab is hidden, then resumes when you return. Manual <b>Auto sync</b> in the top bar still refreshes immediately.</p>
            </div>
          </div>
        )}

        {tab === "ALERTS" && (
          <div className="space-y-6">
            <Header title="Notifications" body="Choose how you'd like to hear about new matches — browser alerts and a daily email digest." />
            <Toggle title="Browser push & visual alerts" body="Pings you whenever a fresh sweep matches ≥ 85% computed alignment." defaultChecked />
            <Toggle title="Email digests" body="A daily summary of new matching openings, tailored drafts, and interview schedules." defaultChecked />
            <div className="flex gap-3 rounded-2xl border border-brand-border bg-[#faf7f0] p-4 text-[11px] font-medium leading-relaxed text-brand-pine"><AlertCircle className="h-5 w-5 shrink-0 text-brand-clay" /><p><b>Compliance:</b> Notifications are sent through secure proxies and never store SMTP credentials in local models.</p></div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Header({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-1 border-b border-zinc-100 pb-4">
      <h2 className="font-display text-sm font-extrabold text-zinc-950">{title}</h2>
      <p className="font-sans text-xs font-medium text-zinc-500">{body}</p>
    </div>
  );
}

function SyncTimingCard({ title, interval, body }: { title: string; interval: string; body: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200/60 bg-zinc-50/60 p-4 text-left">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-brand-border bg-white text-brand-clay shadow-sm">
          <Clock className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-zinc-950">{title}</p>
          <p className="mt-1 font-mono text-[11px] font-black uppercase tracking-tight text-brand-clay">{interval}</p>
          <p className="mt-2 text-[11px] font-medium leading-relaxed text-zinc-500">{body}</p>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">{children}</label>;
}

function ChipField({
  label,
  items,
  setItems,
  draft,
  setDraft,
  placeholder,
  addLabel,
  mono = false,
  tone = "zinc",
  badge,
}: {
  label: string;
  items: string[];
  setItems: (next: string[]) => void;
  draft: string;
  setDraft: (v: string) => void;
  placeholder: string;
  addLabel: string;
  mono?: boolean;
  tone?: "zinc" | "rose";
  badge?: React.ReactNode;
}) {
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) {
      setDraft("");
      return;
    }
    setItems([...items, v]);
    setDraft("");
  };
  const chipClass = tone === "rose" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-zinc-200 bg-zinc-50 text-zinc-800";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>{label}</Label>
        {badge}
      </div>
      <div className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} className="h-11 rounded-xl" />
        <Button type="button" onClick={add} className="h-11 shrink-0 rounded-xl bg-brand-pine hover:bg-brand-pine-deep"><Plus className="h-4 w-4 text-brand-clay" /> {addLabel}</Button>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {items.map((item) => (
          <span key={item} className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold ${chipClass} ${mono ? "font-mono" : ""}`}>
            {item}
            <button type="button" onClick={() => setItems(items.filter((i) => i !== item))} className="ml-1 text-zinc-400 hover:text-zinc-950">×</button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[11px] italic text-zinc-400">None added yet.</span>}
      </div>
    </div>
  );
}

function Toggle({ title, body, defaultChecked }: { title: string; body: string; defaultChecked?: boolean }) {
  const [on, setOn] = useState(Boolean(defaultChecked));
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200/50 bg-zinc-50 p-4">
      <div className="space-y-1 text-left">
        <span className="block font-extrabold text-zinc-950">{title}</span>
        <p className="text-[11px] leading-relaxed text-zinc-500">{body}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} onClick={() => setOn((v) => !v)} className={`relative h-5 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-brand-pine" : "bg-zinc-200"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
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
