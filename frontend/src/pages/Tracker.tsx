import { CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, FolderKanban, Layers, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useSearchParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CompanyLogo } from "@/components/ui/company-logo";
import { PortalLogo } from "@/components/ui/PlatformLogos";
import type { Application, ApplicationStatus } from "../types";
import { openExternalApply, statusLabel } from "../utils/jobApply";

interface TrackerProps {
  applications: Application[];
  onUpdate: (id: string, status: ApplicationStatus, notes?: string) => void;
  onSyncApplied?: () => void | Promise<void>;
}

type StageKey = ApplicationStatus | "ALL";

const STAGES: Array<{ key: StageKey; label: string }> = [
  { key: "ALL", label: "All" },
  { key: "external_pending", label: "Awaiting confirmation" },
  { key: "applied", label: "Applied" },
  { key: "viewed", label: "Viewed" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "needs_review", label: "Needs review" },
  { key: "failed", label: "Failed" },
];

const PAGE_SIZE = 5;

function isStage(value: string | null): value is StageKey {
  return STAGES.some((s) => s.key === value);
}

function statusStyle(status: ApplicationStatus): string {
  switch (status) {
    case "external_pending":
      return "bg-amber-50 text-amber-800 border-amber-200/50";
    case "applied":
      return "bg-indigo-50 text-indigo-800 border-indigo-200/50";
    case "viewed":
      return "bg-sky-50 text-sky-800 border-sky-200/50";
    case "interview":
    case "offer":
      return "bg-brand-chalk text-brand-pine border-brand-border/60";
    case "needs_review":
      return "bg-orange-50 text-orange-800 border-orange-200/50";
    case "failed":
    case "rejected":
    case "blocked":
      return "bg-rose-50 text-rose-800 border-rose-200";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
  }
}

export function Tracker({ applications, onUpdate, onSyncApplied }: TrackerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStage = searchParams.get("status");
  const [stage, setStage] = useState<StageKey>(isStage(requestedStage) ? requestedStage : "ALL");
  const [view, setView] = useState<"LIST" | "BOARD">("LIST");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [modalApp, setModalApp] = useState<Application | null>(null);
  const [modalOutcome, setModalOutcome] = useState<"applied" | "failed" | null>(null);
  const [modalNotes, setModalNotes] = useState("");
  const listTopRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isStage(requestedStage) && requestedStage !== stage) setStage(requestedStage);
  }, [requestedStage, stage]);

  const countFor = (key: StageKey) => (key === "ALL" ? applications.length : applications.filter((a) => a.status === key).length);
  const visibleApps = useMemo(() => (stage === "ALL" ? applications : applications.filter((a) => a.status === stage)), [applications, stage]);

  const totalPages = Math.max(1, Math.ceil(visibleApps.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedApps = visibleApps.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const changeStage = (next: StageKey) => {
    setStage(next);
    setPage(1);
    const nextParams = new URLSearchParams(searchParams);
    if (next === "ALL") nextParams.delete("status");
    else nextParams.set("status", next);
    setSearchParams(nextParams, { replace: true });
  };

  const goToPage = (n: number) => {
    setPage(Math.min(Math.max(1, n), totalPages));
    requestAnimationFrame(() => listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const runSync = async () => {
    if (!onSyncApplied || syncing) return;
    setSyncing(true);
    try {
      await onSyncApplied();
    } finally {
      setSyncing(false);
    }
  };

  const openConfirm = (app: Application, outcome: "applied" | "failed") => {
    setModalApp(app);
    setModalOutcome(outcome);
    setModalNotes(app.notes || "");
  };
  const submitConfirm = () => {
    if (!modalApp || !modalOutcome) return;
    onUpdate(modalApp.id, modalOutcome, modalNotes || (modalOutcome === "applied" ? "User confirmed portal application." : "User could not complete portal application."));
    setModalApp(null);
    setModalOutcome(null);
  };

  const appliedRate = Math.round((applications.filter((a) => a.status === "applied").length / (applications.length || 1)) * 100);
  const awaitingCount = countFor("external_pending");
  const appliedCount = countFor("applied");
  const activeCount = countFor("viewed") + countFor("interview") + countFor("offer");

  return (
    <div className="animate-fade-in-slide space-y-6">
      {/* Header */}
      <Card className="flex flex-col items-start justify-between gap-4 rounded-2xl p-6 text-left md:flex-row md:items-center">
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-tight text-zinc-800"><Layers className="h-4 w-4 text-zinc-600" /> Your applications</span>
          <h1 className="font-display text-2xl font-black tracking-tight text-zinc-950">Application tracker</h1>
          <p className="font-sans text-xs font-medium leading-relaxed text-zinc-500">Track every job you've applied to in one place — confirm outcomes, add notes, and watch each role move from applied to offer.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-200/60 bg-zinc-50/60 px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-tight text-zinc-500"><Clock className="h-4 w-4 text-brand-clay" /><span>You confirm every update</span></div>
      </Card>

      {/* Sync panel */}
      {onSyncApplied && (
        <Card className="rounded-2xl">
          <div className="flex flex-col justify-between gap-2.5 p-3.5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2 text-[11px] font-medium text-zinc-600">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-brand-clay" />
              <span>Hunter auto-detects jobs you've applied to on your connected portals and adds them here — it runs automatically; use this to refresh right now.</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={runSync} disabled={syncing} className="h-8 shrink-0 rounded-lg text-[11px]">
              {syncing ? <Spinner className="size-3.5" /> : <RefreshCw className="h-3.5 w-3.5 text-zinc-400" />} {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrackerMetric label="Total tracked" value={applications.length} sub="All applications" />
        <TrackerMetric label="Awaiting" value={awaitingCount} sub="Needs confirmation" tone="amber" />
        <TrackerMetric label="Applied" value={appliedCount} sub={`${appliedRate}% confirmed`} tone="indigo" />
        <TrackerMetric label="Active signals" value={activeCount} sub="Viewed, interview, offer" tone="emerald" />
      </div>

      {/* Stage tabs + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view === "LIST" ? (
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => changeStage(s.key)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-bold transition-all ${stage === s.key ? "border-brand-pine bg-brand-pine text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-pine/40"}`}
              >
                {s.label} <span className={`rounded px-1.5 font-mono text-[9px] ${stage === s.key ? "bg-white/20" : "bg-zinc-100 text-zinc-500"}`}>{countFor(s.key)}</span>
              </button>
            ))}
          </div>
        ) : (
          <span className="text-[11px] font-medium text-zinc-500">Board view — all stages at a glance.</span>
        )}
        <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5">
          {([["LIST", Layers, "List"], ["BOARD", FolderKanban, "Board"]] as const).map(([val, Icon, label]) => (
            <button key={val} type="button" onClick={() => setView(val)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${view === val ? "bg-brand-pine text-white" : "text-zinc-500 hover:text-zinc-900"}`}>
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {view === "BOARD" ? (
        <TrackerBoard applications={applications} onConfirm={openConfirm} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-12">
          <Card ref={listTopRef} className="space-y-4 rounded-2xl p-6 scroll-mt-4 lg:col-span-8">
            <h2 className="border-b border-zinc-100 pb-1 text-left font-sans text-sm font-extrabold text-zinc-950">Applications ({visibleApps.length})</h2>
            <div className="space-y-4 pt-1">
              {visibleApps.length === 0 && <p className="py-6 text-center text-xs italic text-zinc-400">No applications in this stage.</p>}
              {pagedApps.map((app) => (
                <div key={app.id} className="space-y-4 rounded-2xl border border-zinc-200/50 bg-white p-4 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50/20 sm:p-5">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="flex min-w-0 items-start gap-3">
                      <CompanyLogo company={app.company} logoUrl={app.companyLogoUrl} externalUrl={app.externalApplyUrl} size="md" />
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${statusStyle(app.status)}`}>{statusLabel(app.status)}</span>
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] font-extrabold tracking-tight text-zinc-400">VIA <PortalLogo name={app.portal} size="badge" /></span>
                        </div>
                        <h3 className="mt-1 line-clamp-2 text-sm font-extrabold text-zinc-950">{app.title}</h3>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
                          <span className="font-bold text-zinc-700">{app.company}</span>
                          {app.location && (
                            <>
                              <span className="text-zinc-300">•</span>
                              <span>{app.location}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {app.score > 0 ? (
                      <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200/70 bg-zinc-50 p-1.5 font-mono text-[10px] font-bold"><span className="rounded border border-brand-border bg-brand-chalk px-1.5 py-0.5 font-extrabold text-brand-pine">{app.score}%</span><span className="text-zinc-500">RESUME FIT</span></div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-violet-200/70 bg-violet-50 p-1.5 font-mono text-[10px] font-bold"><span className="inline-flex items-center gap-1 uppercase tracking-tight text-violet-700">Imported · <PortalLogo name={app.portal} size="badge" /></span></div>
                    )}
                  </div>
                  <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-zinc-200/50 bg-zinc-50/60 p-3 font-mono text-[10px] font-bold tracking-tight md:flex-row md:items-center">
                    <div className="flex items-center gap-1.5 text-zinc-500"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-clay" /><span>Document: <b className="text-zinc-700">{app.resumeVersion}</b></span></div>
                    {app.status === "external_pending" ? (
                      <div className="flex items-center gap-1.5 font-bold text-amber-800"><span>Updated {app.latestDate}</span></div>
                    ) : (
                      <div className="flex items-center gap-1 font-bold text-brand-pine"><span>Updated:</span><span className="rounded border border-brand-border bg-brand-chalk px-1.5 py-0.5 text-[9px] text-brand-pine">{app.latestDate}</span></div>
                    )}
                  </div>
                  {app.notes && <p className="px-1 text-[11px] font-medium leading-relaxed text-zinc-500">{app.notes}</p>}
                  {app.status === "external_pending" && (
                    <Alert variant="warning" className="rounded-2xl">
                      <AlertTitle>Finish this role on the original listing.</AlertTitle>
                      <AlertDescription className="text-zinc-600">Once you've applied, confirm the outcome here so your tracker stays up to date.</AlertDescription>
                      <div className="flex flex-wrap items-center gap-3 pt-3">
                        <Button type="button" onClick={() => openConfirm(app, "applied")} className="h-9 rounded-xl bg-brand-pine hover:bg-brand-pine-deep"><CheckCircle2 className="h-4 w-4 text-brand-clay" /> Yes, I applied</Button>
                        <Button type="button" variant="outline" onClick={() => openConfirm(app, "failed")} className="h-9 rounded-xl"><XCircle className="h-4 w-4 text-zinc-400" /> Couldn't apply</Button>
                        {app.externalApplyUrl && (
                          <Button type="button" variant="ghost" onClick={() => openExternalApply(app.externalApplyUrl)} className="h-9 rounded-xl text-zinc-900">Open listing <ExternalLink className="h-4 w-4 text-zinc-400" /></Button>
                        )}
                      </div>
                    </Alert>
                  )}
                </div>
              ))}
            </div>

            {visibleApps.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 pt-4">
                <span className="font-mono text-[11px] text-zinc-400">Showing <b className="font-sans text-zinc-700">{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visibleApps.length)}</b> of {visibleApps.length}</span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-all hover:border-brand-pine/40 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <button key={i} type="button" onClick={() => goToPage(i + 1)} className={`h-8 min-w-8 rounded-lg border px-2 text-[11px] font-bold transition-all ${currentPage === i + 1 ? "border-brand-pine bg-brand-pine text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-pine/40"}`}>{i + 1}</button>
                  ))}
                  <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-all hover:border-brand-pine/40 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </Card>

          {/* Pipeline summary */}
          <Card className="h-fit space-y-5 rounded-2xl p-6 text-left lg:col-span-4">
            <h3 className="text-left font-mono text-xs font-extrabold uppercase tracking-widest text-zinc-950">Pipeline summary</h3>
            <div className="space-y-5 font-sans text-xs text-zinc-500">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400"><span>Applied rate</span><span className="font-sans font-extrabold text-zinc-950">{appliedRate}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full border border-zinc-200/30 bg-zinc-100"><div className="h-full bg-brand-pine transition-all duration-500" style={{ width: `${appliedRate}%` }} /></div>
              </div>
              <div className="space-y-3 border-t border-zinc-100 pt-4">
                <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">By stage</span>
                <div className="space-y-2.5 font-mono text-[11px] font-bold tracking-tight">
                  <SummaryRow dot="bg-amber-500" label="Awaiting confirmation" value={countFor("external_pending")} pill="text-amber-700 bg-amber-50" />
                  <SummaryRow dot="bg-indigo-500" label="Confirmed Applied" value={countFor("applied")} pill="text-indigo-800 bg-indigo-50" />
                  <SummaryRow dot="bg-sky-500" label="Recruiter Viewed" value={countFor("viewed")} pill="text-sky-800 bg-sky-50" />
                  <SummaryRow dot="bg-brand-clay" label="Interview Schedules" value={countFor("interview")} pill="text-brand-pine bg-brand-chalk border border-brand-border/50" />
                  <SummaryRow dot="bg-emerald-500" label="Offers" value={countFor("offer")} pill="text-emerald-800 bg-emerald-50" />
                  <SummaryRow dot="bg-zinc-400" label="Failed / Abandoned" value={countFor("failed")} pill="text-zinc-700 bg-zinc-100" />
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Confirm modal */}
      {modalApp && modalOutcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="w-full max-w-md animate-fade-in-slide space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-100 pb-2">
              <div className="flex min-w-0 items-start gap-3">
                <CompanyLogo company={modalApp.company} logoUrl={modalApp.companyLogoUrl} externalUrl={modalApp.externalApplyUrl} size="sm" />
                <div className="min-w-0">
                  <h3 className="font-sans text-sm font-black text-zinc-950">Update application status</h3>
                  <p className="truncate text-[11px] font-medium text-zinc-500">{modalApp.company}</p>
                </div>
              </div>
              <button type="button" onClick={() => setModalApp(null)} className="text-xl font-bold leading-none text-zinc-400 hover:text-zinc-950">×</button>
            </div>
            <div className="space-y-1.5 text-left font-sans text-xs leading-normal text-zinc-500">
              <p>Move <b>{modalApp.title} ({modalApp.company})</b> into:</p>
              <span className={`inline-block rounded-md border px-2.5 py-0.5 font-mono font-bold uppercase tracking-wider ${statusStyle(modalOutcome)}`}>{statusLabel(modalOutcome)}</span>
            </div>
            <div className="space-y-1.5 text-left">
              <label className="block text-xs font-bold text-zinc-500">Notes (optional)</label>
              <Textarea value={modalNotes} onChange={(e) => setModalNotes(e.target.value)} placeholder="e.g. Uploaded tailored draft, completed questionnaires." className="h-20 rounded-xl" />
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <Button type="button" variant="outline" onClick={() => setModalApp(null)} className="h-9 rounded-xl">Cancel</Button>
              <Button type="button" onClick={submitConfirm} className="h-9 rounded-xl bg-brand-pine hover:bg-brand-pine-deep">Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ dot, label, value, pill }: { dot: string; label: string; value: number; pill: string }) {
  return (
    <div className="flex items-center justify-between text-zinc-700">
      <span className="flex items-center gap-1.5 font-sans font-medium text-zinc-500"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} /> {label}</span>
      <span className={`rounded px-1.5 font-extrabold ${pill}`}>{value}</span>
    </div>
  );
}

function TrackerMetric({
  label,
  value,
  sub,
  tone = "zinc",
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "zinc" | "amber" | "indigo" | "emerald";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-100 bg-amber-50 text-amber-800"
      : tone === "indigo"
        ? "border-indigo-100 bg-indigo-50 text-indigo-800"
        : tone === "emerald"
          ? "border-emerald-100 bg-emerald-50 text-emerald-800"
          : "border-zinc-200 bg-white text-zinc-900";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <span className="font-mono text-[9px] font-black uppercase tracking-wider opacity-65">{label}</span>
      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="font-display text-2xl font-black leading-none">{value}</span>
        <span className="text-right text-[11px] font-bold opacity-70">{sub}</span>
      </div>
    </div>
  );
}

const BOARD_STAGES: Array<{ key: ApplicationStatus; label: string }> = [
  { key: "external_pending", label: "Awaiting" },
  { key: "applied", label: "Applied" },
  { key: "viewed", label: "Viewed" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
];

function TrackerBoard({ applications, onConfirm }: { applications: Application[]; onConfirm: (app: Application, outcome: "applied" | "failed") => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
      {BOARD_STAGES.map((col) => {
        const items = applications.filter((a) => a.status === col.key);
        return (
          <Card key={col.key} className="space-y-3 rounded-2xl p-3">
            <div className="flex items-center justify-between px-1">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">{col.label}</span>
              <span className="rounded bg-zinc-100 px-1.5 font-mono text-[10px] font-bold text-zinc-500">{items.length}</span>
            </div>
            <div className="space-y-2.5">
              {items.length === 0 && <p className="py-4 text-center text-[11px] italic text-zinc-400">Empty</p>}
              {items.map((app) => (
                <div key={app.id} className="space-y-2 rounded-xl border border-zinc-200/60 bg-white p-3 text-left shadow-sm">
                  <div className="flex items-center gap-2">
                    <CompanyLogo company={app.company} logoUrl={app.companyLogoUrl} externalUrl={app.externalApplyUrl} size="sm" />
                    <div className="min-w-0">
                      <span className="block truncate text-[11px] font-bold text-zinc-900">{app.company}</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] font-bold uppercase text-zinc-400">Via <PortalLogo name={app.portal} size="badge" /></span>
                    </div>
                  </div>
                  <p className="line-clamp-2 text-[11px] font-medium text-zinc-500">{app.title}</p>
                  {app.score > 0 && <span className="inline-block rounded border border-brand-border bg-brand-chalk px-1.5 py-0.5 font-mono text-[9px] font-bold text-brand-pine">{app.score}%</span>}
                  {app.status === "external_pending" && (
                    <Button type="button" size="sm" onClick={() => onConfirm(app, "applied")} className="h-7 w-full rounded-lg bg-brand-pine text-[10px] hover:bg-brand-pine-deep">Confirm applied</Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
