import { ArrowUpRight, Briefcase, ChevronRight, FileText, LayoutGrid, List, MapPin, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { TailorModal } from "../components/TailorModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CompanyLogo } from "@/components/ui/company-logo";
import { Input } from "@/components/ui/input";
import { MatchMeter } from "@/components/ui/primitives";
import { PortalLogo } from "@/components/ui/PlatformLogos";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { JobMatch, SearchRunSummary } from "../types";
import { displayJobStatus, isExternalApplyJob, jobSnapshotPayload, openExternalApply, statusLabel } from "../utils/jobApply";
import { apiErrorMessage, jobsAPI } from "../api/client";
import { useToast } from "../components/Toast";

interface JobsProps {
  jobs: JobMatch[];
  onApprove?: (id: string) => void;
  onSkip: (id: string) => void;
  onQueue: (id: string) => void;
  onRefresh: () => void | Promise<unknown>;
  onSearch?: (query: string, options?: { locations?: string[]; minScore?: number }) => void | Promise<void>;
  searchLoading?: boolean;
  lastSearchSummary?: SearchRunSummary | null;
  onLoadMore?: () => void | Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
  applyingLocked?: boolean;
  recommendThreshold?: number;
}

function portalDisplayName(portal: string): string {
  const map: Record<string, string> = { naukri: "Naukri", foundit: "Foundit", internshala: "Internshala" };
  return map[portal?.toLowerCase()] || (portal ? portal.charAt(0).toUpperCase() + portal.slice(1) : "the portal");
}

// Brand colours matching each portal's logo (PlatformLogos), used to tint the
// "Open on <portal>" button. Falls back to brand-pine for unmapped portals.
const PORTAL_ACCENT: Record<string, string> = {
  naukri: "#2460fb",
  foundit: "#7206A9",
  internshala: "#008BD2",
  infosys: "#007cc3",
  hcltech: "#0075c9",
  capgemini: "#0070ad",
};
function portalAccent(portal: string): string {
  return PORTAL_ACCENT[(portal || "").toLowerCase()] || "#18181b";
}

function scoreTone(s: number, threshold = 60) {
  if (s >= 85) return { text: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", label: "Strong match" };
  if (s >= threshold) return { text: "text-brand-pine", bg: "bg-brand-chalk", border: "border-brand-border", label: "Recommended" };
  return { text: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", label: "Below target" };
}

function salaryVal(s: string): number {
  const m = (s || "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function splitSearchLocations(value: string): string[] | undefined {
  const locations = value.split(",").map((item) => item.trim()).filter(Boolean);
  return locations.length ? locations : undefined;
}

export function Jobs({ jobs, onSkip, onQueue, onRefresh, onSearch, searchLoading = false, lastSearchSummary, onLoadMore, hasMore = false, loadingMore = false, applyingLocked = false, recommendThreshold = 60 }: JobsProps) {
  const [searchDraft, setSearchDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [filterTerm, setFilterTerm] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id || "");
  const [selectedPortal, setSelectedPortal] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [resultView, setResultView] = useState<"LIST" | "GRID">("LIST");
  const [sortBy, setSortBy] = useState<"MATCH" | "SALARY" | "COMPANY">("MATCH");
  const [tailorJob, setTailorJob] = useState<JobMatch | null>(null);
  const [tailoringPrepId, setTailoringPrepId] = useState("");
  const toast = useToast();

  // Tailoring needs a persisted job_match. Session-only search results have a synthetic id,
  // so persist the snapshot first (as a pending match, no application), then open the modal
  // with the real id. Already-persisted jobs open straight away.
  const handleTailor = async (job: JobMatch) => {
    if (job.persisted !== false) {
      setTailorJob(job);
      return;
    }
    setTailoringPrepId(job.id);
    try {
      const response = await jobsAPI.persistMatchSnapshot(jobSnapshotPayload(job));
      const matchId = response.data?.match_id as string | undefined;
      if (!matchId) throw new Error("No match id returned");
      setTailorJob({ ...job, id: matchId, persisted: true });
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not prepare this job for tailoring."));
    } finally {
      setTailoringPrepId("");
    }
  };

  const portals = useMemo(() => Array.from(new Set(jobs.map((job) => job.portal))), [jobs]);

  const filteredJobs = useMemo(
    () =>
      jobs.filter((job) => {
        const q = filterTerm.toLowerCase();
        const matchesSearch =
          !q ||
          job.title.toLowerCase().includes(q) ||
          job.company.toLowerCase().includes(q) ||
          job.matchedSkills.some((s) => s.toLowerCase().includes(q)) ||
          job.missingSkills.some((s) => s.toLowerCase().includes(q));
        const matchesPortal = selectedPortal === "ALL" || job.portal === selectedPortal;
        const matchesStatus = statusFilter === "ALL" || displayJobStatus(job) === statusFilter;
        return matchesSearch && matchesPortal && matchesStatus && job.status !== "skipped";
      }),
    [jobs, filterTerm, selectedPortal, statusFilter]
  );

  const sortedJobs = useMemo(() => {
    const arr = [...filteredJobs];
    if (sortBy === "MATCH") arr.sort((a, b) => b.score - a.score);
    else if (sortBy === "SALARY") arr.sort((a, b) => salaryVal(b.salary) - salaryVal(a.salary));
    else if (sortBy === "COMPANY") arr.sort((a, b) => a.company.localeCompare(b.company));
    return arr;
  }, [filteredJobs, sortBy]);

  const threshold = lastSearchSummary?.minScore || recommendThreshold;
  const recommendedCount = useMemo(() => sortedJobs.filter((j) => j.score >= threshold).length, [sortedJobs, threshold]);
  const selectedJob = useMemo(() => sortedJobs.find((j) => j.id === selectedJobId) || sortedJobs[0] || null, [selectedJobId, sortedJobs]);
  const showTailor = selectedJob ? isExternalApplyJob(selectedJob) : false;

  useEffect(() => {
    if (selectedJob && selectedJob.id !== selectedJobId) setSelectedJobId(selectedJob.id);
  }, [selectedJob, selectedJobId]);

  const runSearch = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await onSearch?.(searchDraft, { locations: splitSearchLocations(locationDraft) });
  };

  const openSelectedPortal = (job: JobMatch) => {
    if (job.status === "external_pending" && job.externalApplyUrl) openExternalApply(job.externalApplyUrl);
    else onQueue(job.id);
  };

  return (
    <div className="min-w-0 animate-fade-in-slide space-y-6">
      {/* Header */}
      <div>
        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand-clay">Jobs Shortlists</span>
        <h1 className="mt-1 font-display text-2xl font-black tracking-tight text-brand-pine">Job matches</h1>
        <p className="mt-1 text-sm text-brand-sand">Search live roles, compare fit, then open the original portal.</p>
      </div>

      {/* Unified search + refine workbench */}
      <Card className="overflow-hidden rounded-2xl">
        {/* Step 1 — fetch from portals */}
        <form onSubmit={runSearch} className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400"><Search className="h-3.5 w-3.5 text-brand-clay" /> Step 1 · Search portals</span>
            <span className="hidden text-[10px] font-medium text-zinc-400 sm:inline">— fetch fresh roles from Naukri, Foundit, Internshala & connected sites</span>
          </div>
          <div className="flex flex-col items-stretch gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 z-10 h-4 w-4 text-zinc-400" />
              <Input value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} disabled={searchLoading} placeholder="Role or title to fetch (e.g. React Developer)…" className="h-10 rounded-xl pl-10 font-medium" />
            </div>
            <div className="relative md:w-64">
              <MapPin className="absolute left-3.5 top-3 z-10 h-4 w-4 text-zinc-400" />
              <Input value={locationDraft} onChange={(e) => setLocationDraft(e.target.value)} disabled={searchLoading} placeholder="Mumbai, Pune, Remote" className="h-10 rounded-xl pl-10 font-medium" />
            </div>
            <Button type="submit" disabled={searchLoading} className="h-10 rounded-xl bg-brand-pine px-5 hover:bg-brand-pine-deep">
              {searchLoading ? <Spinner className="size-4" /> : <Search className="h-4 w-4" />} Search portals
            </Button>
            <Button type="button" variant="outline" disabled={searchLoading} onClick={() => onSearch?.("", { locations: splitSearchLocations(locationDraft) })} className="h-10 rounded-xl">
              <Sparkles className="h-4 w-4 text-brand-clay" /> Find from profile
            </Button>
          </div>
          {lastSearchSummary && (
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-brand-border bg-[#faf7f0] p-3.5 text-[11px] lg:flex-row lg:items-center">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono font-bold text-zinc-600">
                <span>Query: <b className="font-sans text-zinc-900">{lastSearchSummary.query || "(saved profile)"}</b></span>
                <span className="text-zinc-300">|</span>
                <span>Fetched <b className="text-zinc-900">{lastSearchSummary.fetchedCount}</b></span>
                <span>Scored <b className="text-zinc-900">{lastSearchSummary.savedCount}</b></span>
                <span>Recommended <b className="text-brand-pine">{lastSearchSummary.recommendedCount}</b></span>
              </div>
            </div>
          )}
        </form>

        {/* Step 2 — refine loaded */}
        <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400"><SlidersHorizontal className="h-3.5 w-3.5" /> Step 2 · Refine saved matches</span>
            <div className="font-mono text-[11px] font-medium text-zinc-400">Showing <b className="font-sans text-zinc-900">{filteredJobs.length}</b> of {jobs.length} saved</div>
          </div>
          <div className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-3 z-10 h-4 w-4 text-zinc-400" />
              <Input value={filterTerm} onChange={(e) => setFilterTerm(e.target.value)} placeholder="Filter saved matches by skill, company or tag…" className="h-10 rounded-xl bg-white pl-10 font-medium" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={selectedPortal} onValueChange={setSelectedPortal}>
                <SelectTrigger className="h-10 w-[170px] rounded-xl text-xs font-bold"><SelectValue placeholder="All portal sources" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All portal sources</SelectItem>
                  {portals.map((p) => (<SelectItem key={p} value={p}>{portalDisplayName(p)}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-[150px] rounded-xl text-xs font-bold"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  {["external_pending", "applied", "failed"].map((s) => (<SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      {/* Results header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-extrabold text-zinc-900">{sortedJobs.length} {sortedJobs.length === 1 ? "job" : "jobs"}</span>
          {recommendedCount > 0 && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700">{recommendedCount} recommended</span>}
        </div>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="h-9 w-[150px] rounded-xl text-[11px] font-bold"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MATCH">Best match</SelectItem>
              <SelectItem value="SALARY">Highest salary</SelectItem>
              <SelectItem value="COMPANY">Company A–Z</SelectItem>
            </SelectContent>
          </Select>
          <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-0.5">
            {([["LIST", List], ["GRID", LayoutGrid]] as const).map(([val, Icon]) => (
              <button key={val} type="button" onClick={() => setResultView(val)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${resultView === val ? "bg-brand-pine text-white" : "text-zinc-500 hover:text-zinc-900"}`}>
                <Icon className="h-3.5 w-3.5" /> {val === "LIST" ? "List" : "Grid"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Two-pane list + detail */}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
        <div className="min-w-0 space-y-3 xl:pr-2">
          <div className={resultView === "GRID" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2" : "space-y-3"}>
            {sortedJobs.length === 0 ? (
              <Card className="space-y-3 rounded-2xl p-10 text-center">
                <Search className="mx-auto h-8 w-8 text-zinc-300" />
                {jobs.length > 0 ? (
                  <>
                    <h3 className="text-sm font-bold text-zinc-900">{jobs.length} jobs saved, but filters hide them all</h3>
                    <p className="text-xs leading-relaxed text-zinc-500">
                      {filterTerm && <>Keyword filter <b>“{filterTerm}”</b> is active. </>}
                      {selectedPortal !== "ALL" && <>Portal is limited to <b>{portalDisplayName(selectedPortal)}</b>. </>}
                      {statusFilter !== "ALL" && <>Status is limited to <b>{statusLabel(statusFilter)}</b>. </>}
                      Clear the filters to see them.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { setFilterTerm(""); setSelectedPortal("ALL"); setStatusFilter("ALL"); }}
                      className="mx-auto h-9 rounded-xl"
                    >
                      <SlidersHorizontal className="h-4 w-4" /> Reset filters
                    </Button>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-bold text-zinc-900">No jobs loaded yet</h3>
                    <p className="text-xs leading-relaxed text-zinc-500">Hunter checks your saved profile automatically when you sign in. Use Search portals or Find from profile here if the automatic fetch needs a retry.</p>
                  </>
                )}
              </Card>
            ) : (
              sortedJobs.map((job) => {
                const active = job.id === selectedJob?.id;
                const tone = scoreTone(job.score, threshold);
                return (
                  <div
                    key={job.id}
                    onClick={() => setSelectedJobId(job.id)}
                    className={`relative cursor-pointer rounded-2xl border p-4 text-left transition-all ${
                      active
                        ? "border-brand-pine/70 bg-[#faf7f0] shadow-md ring-2 ring-brand-pine/10"
                        : "border-brand-border bg-white shadow-sm hover:border-brand-pine/40 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} externalUrl={job.externalApplyUrl} size="md" />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <PortalLogo name={job.portal} size="badge" />
                            {displayJobStatus(job) !== "pending" && <span className="font-mono text-[9px] font-bold uppercase text-zinc-400">{statusLabel(displayJobStatus(job))}</span>}
                          </div>
                          <h3 className="line-clamp-2 font-display text-xs font-extrabold leading-snug text-zinc-950 sm:text-sm">{job.title}</h3>
                          <p className="font-sans text-xs font-bold text-zinc-600">{job.company}</p>
                        </div>
                      </div>
                      <div className={`flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl border font-mono text-sm font-extrabold leading-none ${tone.bg} ${tone.text} ${tone.border}`}>
                        <span>{job.score}</span><span className="mt-0.5 font-sans text-[6px] font-extrabold tracking-tight text-zinc-400">MATCH</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 font-mono text-[10px] font-bold text-zinc-500">
                      {job.salary && <><span className="text-zinc-700">{job.salary}</span><span className="text-zinc-300">•</span></>}
                      {job.location && <><span className="flex items-center gap-0.5"><MapPin className="h-3 w-3 text-zinc-400" /> {job.location.split(",")[0]}</span><span className="text-zinc-300">•</span></>}
                      {job.experience && <span className="flex items-center gap-0.5"><Briefcase className="h-3 w-3 text-zinc-400" /> {job.experience}</span>}
                    </div>
                    <div className="flex items-center gap-2 pt-2.5">
                      <div className="flex-1"><MatchMeter pct={job.score} /></div>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wide ${tone.bg} ${tone.text} ${tone.border}`}>{tone.label}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {hasMore && sortedJobs.length > 0 && (
            <Button type="button" variant="outline" onClick={() => void onLoadMore?.()} disabled={loadingMore} className="h-10 w-full rounded-2xl">
              {loadingMore ? <><Spinner className="size-4" /> Fetching next page…</> : <>Load more results <ChevronRight className="h-4 w-4 rotate-90" /></>}
            </Button>
          )}
        </div>

        <div className="min-w-0 xl:sticky xl:top-3 xl:max-h-[calc(100dvh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1 scrollbar-thin">
          {selectedJob ? (
            <Card className="min-w-0 overflow-hidden rounded-2xl">
              <div className="space-y-5 border-b border-zinc-100 bg-gradient-to-br from-white via-white to-brand-chalk/50 p-5 sm:p-6">
                <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(150px,180px)] xl:items-start">
                  <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                    <CompanyLogo company={selectedJob.company} logoUrl={selectedJob.companyLogoUrl} externalUrl={selectedJob.externalApplyUrl} size="lg" />
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <PortalLogo name={selectedJob.portal} size="sm" />
                        {(selectedJob.applyMethod === "external") && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-700">Applies on company site</span>}
                      </div>
                      <h2 className="max-w-3xl break-words font-display text-lg font-black leading-snug text-zinc-950 sm:text-xl">{selectedJob.title}</h2>
                      <p className="font-sans text-xs font-extrabold text-zinc-900 sm:text-sm">{selectedJob.company}</p>
                    </div>
                  </div>
                  <div className={`rounded-2xl border p-4 shadow-sm ${scoreTone(selectedJob.score, threshold).bg} ${scoreTone(selectedJob.score, threshold).border}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[9px] font-black uppercase tracking-widest text-zinc-400">Match score</span>
                      <Sparkles className="h-4 w-4 text-brand-clay" />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <span className={`font-mono text-3xl font-black leading-none ${scoreTone(selectedJob.score, threshold).text}`}>{selectedJob.score}%</span>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wide ${scoreTone(selectedJob.score, threshold).bg} ${scoreTone(selectedJob.score, threshold).text} ${scoreTone(selectedJob.score, threshold).border}`}>
                        {scoreTone(selectedJob.score, threshold).label}
                      </span>
                    </div>
                    <div className="mt-3">
                      <MatchMeter pct={selectedJob.score} />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-zinc-200/60 bg-white font-sans text-sm text-zinc-500 shadow-sm sm:grid-cols-3">
                  <div className="space-y-1 p-3.5"><span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">Salary</span><p className="truncate text-sm font-extrabold text-zinc-900">{selectedJob.salary || "—"}</p></div>
                  <div className="space-y-1 border-t border-zinc-100 p-3.5 sm:border-l sm:border-t-0"><span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">Experience</span><p className="truncate text-sm font-extrabold text-zinc-900">{selectedJob.experience || "—"}</p></div>
                  <div className="space-y-1 border-t border-zinc-100 p-3.5 sm:border-l sm:border-t-0"><span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">Portal</span><p className="truncate text-sm font-extrabold text-zinc-900">{portalDisplayName(selectedJob.portal)}</p></div>
                </div>
              </div>

              <div className="space-y-5 border-b border-zinc-100 p-5 sm:p-6">
                <div className="space-y-3 rounded-xl border border-brand-border bg-brand-linen p-5">
                  <div className="flex items-center gap-1.5 text-sm font-extrabold text-brand-pine"><Sparkles className="h-4 w-4 text-brand-clay" /><span>Why you're a match</span></div>
                  {selectedJob.note && <p className="text-[13px] font-medium leading-6 text-zinc-700">{selectedJob.note}</p>}
                  {(selectedJob.scoreBreakdown?.merits.length || selectedJob.scoreBreakdown?.demerits.length) ? (
                    <div className="grid gap-5 border-t border-brand-border/50 pt-3 text-[13px] md:grid-cols-2">
                      <div className="space-y-2">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700">What works in your favour</span>
                        <ul className="space-y-1.5 text-zinc-700">
                          {(selectedJob.scoreBreakdown?.merits || []).map((m) => (
                            <li key={m} className="flex items-start gap-2 font-medium leading-6"><span className="shrink-0 font-extrabold text-emerald-600">✓</span><span>{m}</span></li>
                          ))}
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-800">Gaps to be aware of</span>
                        <ul className="space-y-1.5 text-zinc-700">
                          {(selectedJob.scoreBreakdown?.demerits || []).map((d) => (
                            <li key={d} className="flex items-start gap-2 font-medium leading-6"><span className="shrink-0 font-extrabold text-amber-600">•</span><span>{d}</span></li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : (
                    !selectedJob.note && <p className="text-[13px] font-medium leading-6 text-zinc-700">{selectedJob.jdSummary}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-400">Skills match</h4>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-20 shrink-0 font-mono text-[10px] font-bold uppercase text-emerald-600">You have ({selectedJob.matchedSkills.length}):</span>
                      <div className="flex flex-wrap gap-1.5">{selectedJob.matchedSkills.map((skill) => (<span key={skill} className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 font-mono text-[11px] font-medium text-emerald-700">{skill}</span>))}</div>
                    </div>
                    {selectedJob.missingSkills.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="w-20 shrink-0 font-mono text-[10px] font-bold uppercase text-zinc-400">Missing ({selectedJob.missingSkills.length}):</span>
                        <div className="flex flex-wrap gap-1.5">{selectedJob.missingSkills.map((skill) => (<span key={skill} className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[11px] text-zinc-500">{skill}</span>))}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  {showTailor && (
                    <Button onClick={() => handleTailor(selectedJob)} disabled={tailoringPrepId === selectedJob.id} className="h-11 min-w-[180px] flex-1 rounded-xl bg-brand-pine hover:bg-brand-pine-deep">
                      {tailoringPrepId === selectedJob.id ? <Spinner className="size-4" /> : <FileText className="h-4 w-4" />} Tailor my resume
                    </Button>
                  )}
                  <Button
                    onClick={() => openSelectedPortal(selectedJob)}
                    disabled={applyingLocked}
                    style={{ backgroundColor: portalAccent(selectedJob.portal) }}
                    className="h-11 flex-1 rounded-xl text-white shadow-md transition hover:brightness-95"
                  >
                    Open on {portalDisplayName(selectedJob.portal)} <ArrowUpRight className="h-4 w-4 text-white/80" />
                  </Button>
                  <Button variant="ghost" onClick={() => onSkip(selectedJob.id)} className="h-11 shrink-0 rounded-xl text-zinc-400 hover:text-[var(--state-error)]">Skip</Button>
                </div>
                <div className="space-y-2.5">
                  <h4 className="font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-400">Job description</h4>
                  <p className="break-words whitespace-pre-line rounded-xl border border-zinc-200/60 bg-zinc-50/70 p-5 text-sm leading-7 text-zinc-700">{selectedJob.jdFullDescription || selectedJob.jdSummary || "No description snapshot available yet."}</p>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="space-y-2.5 rounded-2xl p-12 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-border bg-brand-chalk"><Sparkles className="h-5 w-5 text-brand-clay" /></div>
              <h3 className="text-sm font-extrabold text-zinc-900">Pick a job to see the details</h3>
              <p className="mx-auto max-w-xs text-xs leading-relaxed text-zinc-500">Select any job on the left to see why you match, the skills you have and miss, and tailor your resume in one tap.</p>
            </Card>
          )}
        </div>
      </div>

      {tailorJob && <TailorModal job={tailorJob} onClose={() => setTailorJob(null)} onApproved={onRefresh} />}
    </div>
  );
}
