import { AlertTriangle, Check, Download, FileText, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusButton } from "@/components/ui/status-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiErrorMessage, jobsAPI, resumeAPI } from "../api/client";
import type { JobMatch } from "../types";

interface TailorModalProps {
  job: JobMatch;
  onClose: () => void;
  onApproved?: () => void | Promise<unknown>;
}

interface TailoredValidation {
  ok?: boolean;
  blocked_claims?: string[];
  warnings?: string[];
  removed_skills?: string[];
}

interface TailoredDraft {
  id?: string;
  status?: string;
  file_url?: string;
  file_type?: string;
  version?: string;
  validation?: TailoredValidation;
}

export function TailorModal({ job, onClose, onApproved }: TailorModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tailored, setTailored] = useState<unknown>(null);
  const [draft, setDraft] = useState<TailoredDraft | null>(null);
  const [parsedResume, setParsedResume] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState("SUMMARY");

  const loadTailoring = async () => {
    setLoading(true);
    setError("");
    setTailored(null);
    setDraft(null);
    try {
      const response = await jobsAPI.tailor(job.id);
      setTailored(response.data?.tailored || null);
      setDraft(response.data?.draft || null);
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not generate tailored resume draft."));
    } finally {
      setLoading(false);
    }
  };

  const loadResume = async () => {
    try {
      const response = await resumeAPI.getParsed();
      setParsedResume(asRecord(response.data?.parsed_data));
    } catch {
      setParsedResume(null);
    }
  };

  const approveTailored = async () => {
    if (!draft?.id) {
      setError("Generate a tailored resume draft before approving.");
      throw new Error("no draft");
    }
    setError("");
    try {
      await jobsAPI.approveTailored(job.id, draft.id);
      await onApproved?.();
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught, "Could not approve tailored resume."));
      throw caught;
    }
  };

  useEffect(() => {
    void loadResume();
    void loadTailoring();
  }, [job.id]);

  const validationOk = draft ? (draft.validation?.ok ?? draft.status !== "failed_validation") : false;
  const blockedClaims = draft?.validation?.blocked_claims || [];
  const warnings = draft?.validation?.warnings || [];
  const removedSkills = draft?.validation?.removed_skills || [];

  const t = asRecord(tailored);
  const tSummary = typeof tailored === "string" ? tailored : text(t.tailored_summary);
  const tSkills = stringArray(t.reordered_skills);
  const tBullets = stringArray(t.highlighted_experience);
  const tChanges = stringArray(t.changes_made);

  return (
    <div className="fixed inset-0 z-50 bg-zinc-900/60 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true">
      <div className="mx-auto flex max-h-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand-clay">Resume tailoring</span>
            <h2 className="truncate font-display text-base font-extrabold text-brand-pine">{job.title} · {job.company}</h2>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <MetaChip label="Version" value={draft?.version || (loading ? "generating" : "—")} />
              <MetaChip label="Status" value={draft?.status || (loading ? "drafting" : "not ready")} />
              <MetaChip label="File" value={(draft?.file_type || "docx").toUpperCase()} />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50">
            <X size={16} />
          </button>
        </header>

        <div className="grid gap-4 overflow-auto p-5 lg:grid-cols-2">
          {/* Current resume */}
          <section className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-4">
            <h3 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400"><FileText className="h-3.5 w-3.5" /> Your current resume</h3>
            <pre className="mt-3 max-h-[44vh] overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 font-mono text-xs leading-6 text-zinc-600 scrollbar-thin">{formatCurrentResume(parsedResume)}</pre>
          </section>

          {/* Tailored draft with tabs */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
            <h3 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-brand-pine"><Sparkles className="h-3.5 w-3.5 text-brand-clay" /> Tailored version</h3>
            {loading ? (
              <p className="mt-3 flex items-center gap-2 py-10 text-center text-xs text-zinc-400"><Spinner className="size-4" /> Generating tailored resume draft…</p>
            ) : error ? (
              <Alert variant="destructive" className="mt-3">
                <AlertTitle>Tailoring stopped</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            ) : !tailored ? (
              <p className="mt-3 py-10 text-center text-xs text-zinc-400">No tailored suggestion returned yet for {job.company}.</p>
            ) : (
              <Tabs value={tab} onValueChange={setTab} className="mt-3">
                <TabsList className="h-auto w-full justify-start gap-1 rounded-xl bg-zinc-100 p-1">
                  <TabsTrigger value="SUMMARY" className="rounded-lg px-3 py-1.5 text-[11px] font-bold data-[state=active]:bg-brand-pine data-[state=active]:text-white">Summary</TabsTrigger>
                  <TabsTrigger value="SKILLS" className="rounded-lg px-3 py-1.5 text-[11px] font-bold data-[state=active]:bg-brand-pine data-[state=active]:text-white">Skills order</TabsTrigger>
                  <TabsTrigger value="BULLETS" className="rounded-lg px-3 py-1.5 text-[11px] font-bold data-[state=active]:bg-brand-pine data-[state=active]:text-white">Project bullets</TabsTrigger>
                </TabsList>
                <div className="mt-3 max-h-[38vh] overflow-auto scrollbar-thin">
                  <TabsContent value="SUMMARY">
                    <p className="whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-xs leading-6 text-zinc-700">{tSummary || "No tailored summary generated."}</p>
                  </TabsContent>
                  <TabsContent value="SKILLS">
                    {tSkills.length ? (
                      <div className="flex flex-wrap gap-1.5">{tSkills.map((s, i) => (<span key={s} className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-chalk px-2 py-1 font-mono text-[11px] font-bold text-brand-pine"><span className="text-zinc-400">{i + 1}.</span> {s}</span>))}</div>
                    ) : <p className="py-6 text-center text-xs text-zinc-400">No reordered skills returned.</p>}
                  </TabsContent>
                  <TabsContent value="BULLETS">
                    {tBullets.length ? (
                      <ul className="space-y-2">{tBullets.map((b) => (<li key={b} className="flex gap-2 rounded-xl bg-zinc-50 p-2.5 text-xs leading-5 text-zinc-700"><span className="text-brand-clay">▹</span><span>{b}</span></li>))}</ul>
                    ) : <p className="py-6 text-center text-xs text-zinc-400">No project bullets returned.</p>}
                  </TabsContent>
                </div>
              </Tabs>
            )}
          </section>
        </div>

        {/* Honest validation report */}
        <div className="border-t border-zinc-100 px-5 py-4">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-brand-pine"><ShieldCheck className="h-4 w-4 text-brand-clay" /> How we keep it honest</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <HonestColumn tone="success" title="Nothing invented" items={blockedClaims.length ? blockedClaims : ["All content is grounded in your resume — no fabricated experience."]} muted={!blockedClaims.length} />
            <HonestColumn tone="warning" title="Warnings" items={warnings.length ? warnings : ["None."]} muted={!warnings.length} />
            <HonestColumn tone="neutral" title="De-emphasised" items={removedSkills.length ? removedSkills : ["None."]} muted={!removedSkills.length} />
          </div>

          {tChanges.length > 0 && (
            <p className="mt-3 text-[11px] text-zinc-500"><b className="text-zinc-700">Changes made:</b> {tChanges.join(" · ")}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="inline-flex items-center gap-2 text-xs text-zinc-500">
              <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} />
              AI changes need your approval before use.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={loadTailoring} disabled={loading} className="h-10 rounded-xl"><RefreshCw size={15} /> Regenerate</Button>
              {draft?.file_url ? (
                <a href={draft.file_url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-zinc-200 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50"><Download size={15} /> Download</a>
              ) : (
                <Button type="button" variant="outline" disabled className="h-10 rounded-xl"><Download size={15} /> Download</Button>
              )}
              <StatusButton onClick={approveTailored} disabled={loading || !draft?.id || !validationOk} idleIcon={<Check className="h-4 w-4 text-brand-clay" />} text={{ loading: "Approving…", success: "Approved", error: "Failed" }} className="h-10">
                Approve &amp; use
              </StatusButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HonestColumn({ tone, title, items, muted }: { tone: "success" | "warning" | "neutral"; title: string; items: string[]; muted?: boolean }) {
  const accent = tone === "success" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : "text-zinc-500";
  const mark = tone === "success" ? "✓" : tone === "warning" ? "•" : "–";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/40 p-3">
      <span className={`font-mono text-[9px] font-bold uppercase tracking-widest ${accent}`}>{title}</span>
      <ul className="mt-2 space-y-1 text-[11px] leading-5">
        {items.map((item) => (
          <li key={item} className={`flex gap-1.5 ${muted ? "text-zinc-400" : "text-zinc-700"}`}><span className={accent}>{mark}</span><span>{item}</span></li>
        ))}
      </ul>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[10px] text-zinc-500">
      {label}: <span className="font-bold text-brand-pine">{value}</span>
    </span>
  );
}

function formatCurrentResume(resume: Record<string, unknown> | null): string {
  if (!resume) return "Resume sections appear here after your parsed resume loads.";
  const lines = [
    section("Name", [text(resume.name, "Parsed candidate")]),
    section("Role", [text(resume.current_role), text(resume.total_experience_years) ? `${text(resume.total_experience_years)} years experience` : ""]),
    section("Summary", [text(resume.summary, "Summary parsed from uploaded resume.")]),
    section("Skills", stringArray(resume.skills)),
    section("Education", [text(resume.education)]),
  ].filter(Boolean);
  return lines.join("\n\n");
}

function section(title: string, lines: string[]): string {
  const clean = lines.filter(Boolean);
  if (!clean.length) return "";
  return `${title}\n${clean.map((line) => `- ${line}`).join("\n")}`;
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string" && value.includes(",")) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number") return String(value);
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
