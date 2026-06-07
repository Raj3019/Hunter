import { AlertTriangle, CheckCircle, Clock, ExternalLink, FileText, RefreshCw, Search, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StatusPill } from "../components/StatusPill";
import type { Application, ApplicationStatus } from "../types";
import { openExternalApply, statusLabel } from "../utils/jobApply";

interface TrackerProps {
  applications: Application[];
  onUpdate: (id: string, status: ApplicationStatus, notes?: string) => void;
  onSyncApplied?: () => void | Promise<void>;
}

const stages: Array<{ id: ApplicationStatus; label: string }> = [
  { id: "external_pending", label: "Portal pending" },
  { id: "applied", label: "Applied" },
  { id: "viewed", label: "Viewed" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "needs_review", label: "Needs review" },
  { id: "blocked", label: "Blocked" },
  { id: "failed", label: "Failed" },
  { id: "fetched", label: "Fetched" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
];

function isTrackerStage(value: string | null): value is ApplicationStatus {
  return stages.some((stage) => stage.id === value);
}

function stageTone(status: ApplicationStatus): "neutral" | "success" | "warning" | "error" | "accent" {
  if (status === "applied" || status === "interview" || status === "offer" || status === "viewed") return "success";
  if (status === "approved" || status === "fetched") return "accent";
  if (status === "blocked" || status === "needs_review" || status === "external_pending") return "warning";
  if (status === "failed" || status === "rejected" || status === "archived") return "error";
  return "neutral";
}

export function Tracker({ applications, onUpdate, onSyncApplied }: TrackerProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStage = searchParams.get("status");
  const [selected, setSelected] = useState<Application | null>(null);
  const [portalFilter, setPortalFilter] = useState("all");
  const [activeStage, setActiveStage] = useState<ApplicationStatus>(isTrackerStage(requestedStage) ? requestedStage : "external_pending");
  const [query, setQuery] = useState("");
  const [syncing, setSyncing] = useState(false);

  const runSyncApplied = async () => {
    if (!onSyncApplied || syncing) return;
    setSyncing(true);
    try {
      await onSyncApplied();
    } finally {
      setSyncing(false);
    }
  };

  const portals = useMemo(() => Array.from(new Set(applications.map((app) => app.portal))).sort(), [applications]);
  const counts = useMemo(() => stageCounts(applications), [applications]);
  const attentionCount = applications.filter((app) => ["external_pending", "needs_review", "blocked", "failed"].includes(app.status)).length;

  useEffect(() => {
    if (isTrackerStage(requestedStage) && requestedStage !== activeStage) {
      setActiveStage(requestedStage);
    }
  }, [activeStage, requestedStage]);

  const filtered = useMemo(
    () =>
      applications.filter((app) => {
        const portalMatch = portalFilter === "all" || app.portal === portalFilter;
        const stageMatch = app.status === activeStage;
        const queryMatch =
          query.trim().length === 0 ||
          `${app.title} ${app.company} ${app.portal} ${app.location}`.toLowerCase().includes(query.toLowerCase());
        return portalMatch && stageMatch && queryMatch;
      }),
    [activeStage, applications, portalFilter, query]
  );

  const liveSelected = selected ? applications.find((app) => app.id === selected.id) || selected : null;
  const currentSelected = liveSelected && filtered.some((app) => app.id === liveSelected.id) ? liveSelected : filtered[0] || null;

  const changeStage = (stage: ApplicationStatus) => {
    setActiveStage(stage);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("status", stage);
    setSearchParams(nextParams, { replace: true });
  };

  return (
    <>
      <section className="mb-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Application tracker</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Confirm portal outcomes and keep application history tidy.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {onSyncApplied && (
              <button type="button" onClick={runSyncApplied} disabled={syncing} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-primary)] hover:border-[var(--accent-primary)] disabled:cursor-wait disabled:opacity-70" title="Check Naukri for jobs you've applied to and update statuses">
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing" : "Sync applied status"}
              </button>
            )}
            <Metric label="Waiting" value={counts.external_pending || 0} tone="warning" />
            <Metric label="Applied" value={counts.applied || 0} tone="success" />
            <Metric label="Needs attention" value={attentionCount} tone={attentionCount ? "warning" : undefined} />
          </div>
        </div>
      </section>

      <section className="mb-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 shadow-sm">
        <div className="overflow-x-auto scrollbar-thin">
          <div className="flex min-w-max gap-1">
            {stages.map((stage) => {
              const count = counts[stage.id] || 0;
              const active = activeStage === stage.id;
              return (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => changeStage(stage.id)}
                  className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition ${
                    active ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {stage.label}
                  <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-xs">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2 grid gap-2 border-t border-[var(--border-default)] pt-2 md:grid-cols-[180px_minmax(240px,1fr)]">
          <select aria-label="Portal filter" value={portalFilter} onChange={(event) => setPortalFilter(event.target.value)} className="terminal-field h-10 rounded-md px-3 text-sm">
            <option value="all">All portals</option>
            {portals.map((portal) => (
              <option key={portal} value={portal}>{portal}</option>
            ))}
          </select>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="terminal-field h-10 w-full rounded-md pl-9 pr-3 text-sm" placeholder="Search title, company, portal, location" />
          </div>
        </div>
      </section>

      {applications.some((app) => app.warning) && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-muted)]">
          <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} />
          {applications.filter((app) => app.warning).length} tracker records need review.
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="air-surface min-h-[520px] overflow-hidden rounded-lg">
          <div className="border-b border-[var(--border-default)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{stages.find((stage) => stage.id === activeStage)?.label}</h2>
                <p className="text-xs text-[var(--text-muted)]">{filtered.length} records match the current filters</p>
              </div>
              <StatusPill label={statusLabel(activeStage)} tone={stageTone(activeStage)} />
            </div>
          </div>

          {filtered.length === 0 ? (
            <TrackerEmptyState activeStage={activeStage} />
          ) : (
            <div>
              {filtered.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelected(app)}
                  className={`air-row flex w-full flex-col gap-3 border-l-2 px-4 py-3 text-left transition hover:bg-[var(--bg-elevated)] md:flex-row md:items-center md:justify-between ${
                    currentSelected?.id === app.id ? "border-l-[var(--accent-primary)] bg-[var(--bg-elevated)]" : "border-l-transparent bg-[var(--bg-surface)]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <ScoreBadge score={app.score} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{app.title}</p>
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{app.company} - {app.location}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                    <StatusPill label={app.portal} tone="neutral" />
                    <StatusPill label={statusLabel(app.status)} tone={stageTone(app.status)} />
                    {app.warning ? <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} /> : <CheckCircle size={15} style={{ color: "var(--state-success)" }} />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <ApplicationDetails application={currentSelected} onUpdate={onUpdate} />
      </div>
    </>
  );
}

function ApplicationDetails({ application, onUpdate }: { application?: Application | null; onUpdate: TrackerProps["onUpdate"] }) {
  const [status, setStatus] = useState<ApplicationStatus>(application?.status || "external_pending");
  const [notes, setNotes] = useState(application?.notes || "");

  useEffect(() => {
    if (!application) return;
    setStatus(application.status);
    setNotes(application.notes);
  }, [application]);

  if (!application) {
    return (
      <aside className="air-surface rounded-lg p-4 xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:self-start xl:overflow-y-auto">
        <p className="text-sm font-semibold">No record selected</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">Choose an application to inspect portal status, notes, and confirmation actions.</p>
      </aside>
    );
  }

  return (
    <aside className="air-surface rounded-lg xl:sticky xl:top-24 xl:max-h-[calc(100vh-8rem)] xl:self-start xl:overflow-hidden">
      <div className="border-b border-[var(--border-default)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Application details</p>
              <StatusPill label={statusLabel(application.status)} tone={stageTone(application.status)} />
            </div>
            <h2 className="mt-2 text-xl font-semibold leading-snug">{application.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">{application.company} - {application.portal}</p>
          </div>
          <ScoreBadge score={application.score} large />
        </div>
      </div>

      <div className="max-h-[calc(100vh-18rem)] overflow-y-auto p-4 scrollbar-thin">
        {application.status === "external_pending" && (
          <section className="rounded-lg border border-[var(--state-warning)] bg-[var(--bg-elevated)] p-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ExternalLink size={15} style={{ color: "var(--state-warning)" }} />
              Waiting for confirmation
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
              Finish this role on the original portal, then confirm the result here.
            </p>
            {application.externalApplyUrl && (
              <button type="button" onClick={() => openExternalApply(application.externalApplyUrl)} className="air-button mt-3 h-10 w-full bg-[var(--state-warning)] px-3 text-white">
                <ExternalLink size={15} />
                Open portal
              </button>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => onUpdate(application.id, "applied", notes || "User confirmed portal application was completed.")} className="air-button h-10 bg-[var(--state-success)] px-3 text-white">
                <CheckCircle size={15} />
                I applied
              </button>
              <button type="button" onClick={() => onUpdate(application.id, "failed", notes || "User could not complete portal application.")} className="air-button h-10 border border-[var(--border-default)] px-3 text-[var(--state-error)]">
                <XCircle size={15} />
                Could not apply
              </button>
            </div>
          </section>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--border-default)] py-3 text-sm">
          <Info label="Portal" value={application.portal} />
          <Info label="Location" value={application.location} />
          <Info label="Latest update" value={application.latestDate} />
          <Info label="Resume" value={application.resumeVersion} />
          {application.arsScore !== undefined && <Info label="Naukri match (ARS)" value={`${application.arsScore}`} />}
          {application.companyRating !== undefined && <Info label="Company rating" value={`${application.companyRating}★`} />}
        </dl>

        <section className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
          <p className="text-sm font-semibold">Timeline</p>
          <ol className="mt-3 space-y-3 text-sm text-[var(--text-muted)]">
            {timelineItems(application).map((item) => (
              <li key={item} className="flex gap-2">
                <Clock size={14} className="mt-0.5 shrink-0" />
                {item}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-4 rounded-lg border border-[var(--border-default)] p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <FileText size={15} />
            Portal response
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{application.applyResponse}</p>
        </section>

        {application.warning && (
          <p className="mt-4 flex gap-2 rounded-lg bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--state-warning)" }} />
            {application.warning}
          </p>
        )}

        <label className="mt-4 block text-sm">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as ApplicationStatus)} className="terminal-field mt-1 h-10 w-full rounded-md px-3">
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.label}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-sm">
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} className="terminal-field mt-1 w-full rounded-lg p-3" />
        </label>

        <button type="button" onClick={() => onUpdate(application.id, status, notes)} className="air-button mt-4 h-10 w-full bg-[var(--accent-primary)] px-4 text-white hover:bg-[var(--accent-hover)]">
          Update status
        </button>
      </div>
    </aside>
  );
}

function TrackerEmptyState({ activeStage }: { activeStage: ApplicationStatus }) {
  const message =
    activeStage === "external_pending"
      ? "No portal tasks are waiting for confirmation."
      : activeStage === "applied"
        ? "No applied jobs yet. Confirm portal submissions after you complete them."
        : "No applications match the current filters.";
  return (
    <div className="flex min-h-64 items-center justify-center p-6 text-center">
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">Nothing here yet</p>
        <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">{message}</p>
      </div>
    </div>
  );
}

function stageCounts(applications: Application[]): Partial<Record<ApplicationStatus, number>> {
  return applications.reduce<Partial<Record<ApplicationStatus, number>>>((counts, application) => {
    counts[application.status] = (counts[application.status] || 0) + 1;
    return counts;
  }, {});
}

function timelineItems(application: Application): string[] {
  const items = ["Fetched and scored", application.status === "external_pending" ? "Opened on portal" : "Reviewed in Hunter"];
  if (application.status === "applied") items.push("User confirmed application");
  else if (application.status === "failed") items.push("Marked as could not apply");
  else items.push(`Current state: ${stageLabel(application.status)}`);
  items.push(`Latest update: ${application.latestDate}`);
  return items;
}

function stageLabel(status: ApplicationStatus): string {
  return stages.find((stage) => stage.id === status)?.label || status;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function ScoreBadge({ score, large = false }: { score: number; large?: boolean }) {
  const color = score >= 80 ? "var(--score-high)" : score >= 60 ? "var(--score-mid)" : "var(--score-low)";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-semibold ${large ? "h-14 w-14 text-base" : "h-9 w-9 text-xs"}`}
      style={{ color, borderColor: color }}
    >
      {score}
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: "success" | "warning" }) {
  const color = tone === "success" ? "var(--state-success)" : tone === "warning" ? "var(--state-warning)" : "var(--text-primary)";
  return (
    <div className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-sm font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}
