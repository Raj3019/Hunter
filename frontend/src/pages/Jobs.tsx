import { AlertTriangle, BookOpen, Brain, ExternalLink, FileText, MapPin, Maximize2, Search, ShieldCheck, SlidersHorizontal, Sparkles, X, XCircle } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { StatusPill } from "../components/StatusPill";
import { TailorModal } from "../components/TailorModal";
import type { JobMatch, SearchRunSummary } from "../types";
import { displayJobStatus, isExternalApplyJob, openExternalApply, statusLabel } from "../utils/jobApply";

interface JobsProps {
  jobs: JobMatch[];
  onApprove?: (id: string) => void;
  onSkip: (id: string) => void;
  onQueue: (id: string) => void;
  onRefresh: () => void | Promise<unknown>;
  onSearch?: (query: string, options?: { locations?: string[]; minScore?: number }) => void | Promise<void>;
  searchLoading?: boolean;
  lastSearchSummary?: SearchRunSummary | null;
  searchResultIds?: string[] | null;
  onClearSearchScope?: () => void;
  onLoadMore?: () => void | Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
  applyingLocked?: boolean;
}

function portalDisplayName(portal: string): string {
  const map: Record<string, string> = { naukri: "Naukri", foundit: "Foundit", linkedin: "LinkedIn", internshala: "Internshala" };
  return map[portal?.toLowerCase()] || (portal ? portal.charAt(0).toUpperCase() + portal.slice(1) : "the portal");
}

function scoreColor(score: number) {
  if (score >= 80) return "var(--score-high)";
  if (score >= 60) return "var(--score-mid)";
  return "var(--score-low)";
}

function statusTone(status: JobMatch["status"]) {
  if (status === "approved" || status === "queued" || status === "applying" || status === "applied") return "success";
  if (status === "blocked" || status === "needs_review" || status === "external_pending") return "warning";
  if (status === "failed") return "error";
  return "accent";
}

export function Jobs({ jobs, onSkip, onQueue, onRefresh, onSearch, searchLoading = false, lastSearchSummary, searchResultIds, onClearSearchScope, onLoadMore, hasMore = false, loadingMore = false, applyingLocked = false }: JobsProps) {
  const [portal, setPortal] = useState("all");
  const [status, setStatus] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [selectedId, setSelectedId] = useState(jobs[0]?.id || "");
  const [tailorJob, setTailorJob] = useState<JobMatch | null>(null);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  const scopeActive = Array.isArray(searchResultIds);
  const scopedJobs = useMemo(() => {
    if (!searchResultIds) return jobs;
    const order = new Map(searchResultIds.map((id, index) => [id, index] as const));
    return jobs
      .filter((job) => order.has(job.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [jobs, searchResultIds]);

  // One list, sorted by resume-match score (best first). No recommended/all split.
  const displayedJobs = useMemo(
    () =>
      scopedJobs
        .filter((job) => {
          const portalMatch = portal === "all" || job.portal === portal;
          const statusMatch = status === "all" || displayJobStatus(job) === status;
          return portalMatch && statusMatch && job.score >= minScore && job.status !== "skipped";
        })
        .sort((a, b) => b.score - a.score),
    [scopedJobs, minScore, portal, status]
  );

  const portals = Array.from(new Set(scopedJobs.map((job) => job.portal)));
  const selected = displayedJobs.find((job) => job.id === selectedId) || displayedJobs[0];

  useEffect(() => {
    setDescriptionOpen(false);
  }, [selected?.id]);

  const runSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSearch?.(searchDraft, { locations: splitSearchLocations(locationDraft) });
  };

  return (
    <>
      <section className="mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Job matches</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Search live roles, compare fit, then open the original portal.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {scopeActive && (
              <button type="button" onClick={onClearSearchScope} className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--accent-primary)] bg-[var(--bg-surface)] px-3 text-[var(--accent-primary)] hover:bg-[var(--bg-elevated)]" title="Show all saved matches instead of just this search">
              <Search size={14} />
              Last search ({scopedJobs.length}) · Show all
            </button>
            )}
            <SummaryChip label="Jobs" value={displayedJobs.length} tone="success" />
            <SummaryChip label="Portal pending" value={scopedJobs.filter((job) => job.status === "external_pending").length} tone="warning" />
          </div>
        </div>

        <SearchWorkbench
          query={searchDraft}
          location={locationDraft}
          loading={searchLoading}
          summary={lastSearchSummary}
          onQueryChange={setSearchDraft}
          onLocationChange={setLocationDraft}
          onSubmit={runSearch}
          onProfileSearch={() => onSearch?.("", { locations: splitSearchLocations(locationDraft) })}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="air-surface flex min-h-[560px] overflow-hidden rounded-lg xl:h-[calc(100vh-10rem)]">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-[var(--border-default)] px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">{displayedJobs.length} job{displayedJobs.length === 1 ? "" : "s"}</h2>
                  <p className="text-xs text-[var(--text-muted)]">Sorted by resume match — best fit first.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SlidersHorizontal size={16} className="text-[var(--text-muted)]" />
                  <select aria-label="Portal filter" value={portal} onChange={(event) => setPortal(event.target.value)} className="terminal-field h-9 rounded-md px-2 text-sm">
                    <option value="all">All portals</option>
                    {portals.map((item) => (
                      <option key={item} value={item}>{portalDisplayName(item)}</option>
                    ))}
                  </select>
                  <select aria-label="Status filter" value={status} onChange={(event) => setStatus(event.target.value)} className="terminal-field h-9 rounded-md px-2 text-sm">
                    <option value="all">All statuses</option>
                    {["external_pending", "applied", "failed"].map((item) => (
                      <option key={item} value={item}>{statusLabel(item)}</option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                    Min score
                    <input aria-label="Minimum score" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} type="number" min={0} max={100} className="terminal-field h-9 w-16 rounded-md px-2 text-sm" />
                  </label>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
              {displayedJobs.length === 0 ? (
                <EmptyResults />
              ) : displayedJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelectedId(job.id)}
                className={`air-row grid w-full gap-3 border-l-2 px-4 py-3 text-left transition hover:bg-[var(--bg-elevated)] md:grid-cols-[52px_minmax(0,1fr)_190px] ${
                  selected?.id === job.id ? "border-l-[var(--accent-primary)] bg-[var(--bg-elevated)]" : "border-l-transparent bg-[var(--bg-surface)]"
                }`}
              >
                {(() => {
                  const effectiveStatus = displayJobStatus(job);
                  const external = isExternalApplyJob(job);
                  return (
                    <>
                <div className="flex items-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold" style={{ color: scoreColor(job.score), borderColor: scoreColor(job.score) }}>
                    {job.score}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{job.title}</p>
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{job.company} - {job.location}</p>
                </div>
                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  <StatusPill label={job.portal} tone="neutral" />
                  {effectiveStatus !== "pending" && <StatusPill label={statusLabel(effectiveStatus)} tone={statusTone(effectiveStatus)} />}
                  {(external || effectiveStatus === "blocked" || effectiveStatus === "needs_review" || effectiveStatus === "failed") && (
                    <AlertTriangle size={15} className="text-[var(--state-warning)]" />
                  )}
                </div>
                    </>
                  );
                })()}
              </button>
              ))}
              {scopeActive && hasMore && displayedJobs.length > 0 && (
                <div className="p-3">
                  <button type="button" onClick={() => void onLoadMore?.()} disabled={loadingMore} className="air-button h-10 w-full border border-[var(--border-default)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-wait disabled:opacity-70">
                    {loadingMore ? "Loading more…" : "Load more jobs"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="air-surface rounded-lg xl:sticky xl:top-24 xl:h-[calc(100vh-10rem)] xl:self-start xl:overflow-hidden">
          {selected ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 p-4 pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Selected match</p>
                      {displayJobStatus(selected) !== "pending" && <StatusPill label={statusLabel(displayJobStatus(selected))} tone={statusTone(displayJobStatus(selected))} />}
                    </div>
                    <h2 className="mt-2 text-xl font-semibold leading-snug">{selected.title}</h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">{selected.company} - {selected.portal}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <StatusPill label={portalDisplayName(selected.portal)} tone="neutral" />
                      {(selected.applyMethod === "external" || selected.applyMethod === "native") && (
                        <StatusPill label={selected.applyMethod === "external" ? "Applies on company site" : `Applies on ${portalDisplayName(selected.portal)}`} tone={selected.applyMethod === "external" ? "warning" : "neutral"} />
                      )}
                    </div>
                  </div>
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-lg font-semibold" style={{ color: scoreColor(selected.score), borderColor: scoreColor(selected.score) }}>
                    {selected.score}
                  </div>
                </div>
              </div>

              <MatchActions
                job={selected}
                applyingLocked={applyingLocked}
                onTailor={() => setTailorJob(selected)}
                onQueue={() => onQueue(selected.id)}
                onSkip={() => onSkip(selected.id)}
              />

              <div className="min-h-0 flex-1 overflow-y-auto p-4 pt-4 scrollbar-thin">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--border-default)] py-3 text-sm">
                  <Fact label="Location" value={selected.location} />
                  <Fact label="Experience" value={selected.experience} />
                  <Fact label="Salary" value={selected.salary} />
                  <Fact label="Resume" value={selected.tailoredResumeApproved ? selected.tailoredResumeVersion || "Tailored" : "Base resume"} />
                </dl>

                <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Brain size={14} /> Role snapshot</p>
                    <button type="button" onClick={() => setDescriptionOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-1 text-xs font-medium text-[var(--text-primary)] hover:border-[var(--accent-primary)]" title="View full description">
                      <Maximize2 size={12} />
                      Full
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selected.jdSummary}</p>
                </div>

                <div className="mt-4 grid gap-4">
                  <SkillGroup title="Matched skills" skills={selected.matchedSkills} tone="success" />
                  <SkillGroup title="Missing skills" skills={selected.missingSkills} />
                </div>

                <p className="mt-4 flex gap-2 rounded-lg bg-[var(--bg-elevated)] p-3 text-sm leading-6 text-[var(--text-muted)]">
                  {selected.status === "external_pending" ? <ExternalLink size={16} style={{ color: "var(--state-warning)" }} /> : <ShieldCheck size={16} style={{ color: "var(--state-success)" }} />}
                  {selected.status === "external_pending"
                    ? "This role is waiting for confirmation after opening the original portal."
                    : "Hunter opens the original portal page and tracks this as pending until you confirm the outcome."}
                </p>
              </div>
            </div>
          ) : (
            <p className="p-4 text-sm text-[var(--text-muted)]">No jobs match the current filters.</p>
          )}
        </aside>
      </div>

      {tailorJob && <TailorModal job={tailorJob} onClose={() => setTailorJob(null)} onApproved={onRefresh} />}
      {selected && descriptionOpen && <JobDescriptionModal job={selected} onClose={() => setDescriptionOpen(false)} />}
    </>
  );
}

function SearchWorkbench({
  query,
  location,
  loading,
  summary,
  onQueryChange,
  onLocationChange,
  onSubmit,
  onProfileSearch,
}: {
  query: string;
  location: string;
  loading: boolean;
  summary?: SearchRunSummary | null;
  onQueryChange: (value: string) => void;
  onLocationChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onProfileSearch: () => void | Promise<void>;
}) {
  return (
    <section className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Search live jobs</p>
        {summary && (
          <div className="flex flex-wrap gap-2">
            <SearchStat label="Found" value={summary.fetchedCount} />
            <SearchStat label="Scored" value={summary.savedCount} tone="success" />
          </div>
        )}
      </div>
      <form onSubmit={onSubmit} className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_minmax(180px,0.65fr)_auto_auto] lg:items-end">
        <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Role or keyword
          <div className="relative mt-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              disabled={loading}
              className="terminal-field h-10 w-full rounded-md pl-9 pr-3 text-sm normal-case tracking-normal disabled:cursor-wait disabled:opacity-80"
              placeholder="frontend developer, DevOps, React"
            />
          </div>
        </label>

        <label className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Location
          <div className="relative mt-1">
            <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={location}
              onChange={(event) => onLocationChange(event.target.value)}
              disabled={loading}
              className="terminal-field h-10 w-full rounded-md pl-9 pr-3 text-sm normal-case tracking-normal disabled:cursor-wait disabled:opacity-80"
              placeholder="Mumbai, Pune, Remote"
            />
          </div>
        </label>

        <button type="submit" disabled={loading} className="air-button h-10 bg-[var(--accent-primary)] px-4 text-white hover:bg-[var(--accent-hover)] disabled:cursor-wait disabled:opacity-80">
          {loading ? <Sparkles size={16} className="animate-pulse" /> : <Search size={16} />}
          {loading ? "Searching" : "Search"}
        </button>

        <button type="button" disabled={loading} onClick={onProfileSearch} className="air-button h-10 border border-[var(--border-default)] px-4 text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-wait disabled:opacity-70">
          <Sparkles size={16} />
          Profile
        </button>
      </form>
    </section>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number | string; tone?: "success" | "warning" }) {
  const color = tone === "success" ? "var(--state-success)" : tone === "warning" ? "var(--state-warning)" : "var(--text-primary)";
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-sm font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function SearchStat({ label, value, tone }: { label: string; value: number; tone?: "success" }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-muted)]">
      {label}
      <strong style={{ color: tone === "success" ? "var(--state-success)" : "var(--text-primary)" }}>{value}</strong>
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value || "Not specified"}</dd>
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="flex min-h-64 items-center justify-center p-6 text-center">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">No jobs match the filters</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
          Broaden the portal / status / min-score filters, or run a new search.
        </p>
      </div>
    </div>
  );
}

function MatchActions({
  job,
  applyingLocked,
  onTailor,
  onQueue,
  onSkip,
}: {
  job: JobMatch;
  applyingLocked: boolean;
  onTailor: () => void;
  onQueue: () => void;
  onSkip: () => void;
}) {
  const currentStatus = displayJobStatus(job);
  return (
    <div className="shrink-0 border-y border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" onClick={onTailor} disabled={job.persisted === false} className="air-button h-10 border border-[var(--border-default)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50" title={job.persisted === false ? "Tailoring is available after a job is saved to the review queue." : "Tailor resume"}>
          <FileText size={15} />
          Tailor
        </button>
        {job.status === "external_pending" ? (
          <button type="button" onClick={() => openExternalApply(job.externalApplyUrl || "")} disabled={!job.externalApplyUrl} className="air-button h-10 bg-[var(--state-warning)] text-white disabled:cursor-not-allowed disabled:opacity-50">
            <ExternalLink size={15} />
            Open portal
          </button>
        ) : job.status === "pending" || job.status === "approved" || isExternalApplyJob(job) ? (
          <button type="button" onClick={onQueue} disabled={applyingLocked} className="air-button h-10 bg-[var(--state-success)] text-white disabled:cursor-wait disabled:opacity-80">
            <ExternalLink size={15} />
            {applyingLocked ? "Opening" : "Open portal"}
          </button>
        ) : job.status === "applying" ? (
          <button type="button" disabled className="air-button h-10 bg-[var(--state-success)] text-white opacity-80">
            <ExternalLink size={15} />
            Opening
          </button>
        ) : (
          <button type="button" disabled className="air-button h-10 bg-[var(--accent-primary)] text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            <ShieldCheck size={15} />
            {currentStatus === "failed" || currentStatus === "blocked" ? "Unavailable" : "Ready"}
          </button>
        )}
        <button type="button" onClick={onSkip} disabled={job.status === "applying" || job.status === "applied" || applyingLocked} className="air-button h-10 border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--state-error)] disabled:cursor-not-allowed disabled:opacity-50">
          <XCircle size={15} />
          Skip
        </button>
      </div>
    </div>
  );
}

function JobDescriptionModal({ job, onClose }: { job: JobMatch; onClose: () => void }) {
  const description = job.jdFullDescription || job.jdSummary || "No job description snapshot is available yet.";

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true">
      <section className="mx-auto flex max-h-full max-w-4xl flex-col rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border-default)] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              <BookOpen size={14} />
              Full job description
            </p>
            <h2 className="mt-2 text-xl font-semibold leading-snug">{job.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{job.company} - {job.location}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close full job description" title="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-default)]">
            <X size={15} />
          </button>
        </header>
        <div className="overflow-y-auto p-4 scrollbar-thin">
          <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--text-primary)]">{description}</p>
        </div>
      </section>
    </div>
  );
}

function splitSearchLocations(value: string): string[] | undefined {
  const locations = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return locations.length ? locations : undefined;
}

function SkillGroup({ title, skills, tone }: { title: string; skills: string[]; tone?: "success" }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {skills.map((skill) => (
          <span
            key={skill}
            className="rounded px-2 py-1 text-xs"
            style={
              tone === "success"
                ? { color: "var(--state-success)", background: "color-mix(in srgb, var(--state-success) 12%, transparent)" }
                : { color: "var(--text-muted)", background: "var(--bg-elevated)" }
            }
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}
