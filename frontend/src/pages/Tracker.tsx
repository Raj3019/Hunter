import { AlertTriangle, CheckCircle, Clock, FileText, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Application, ApplicationStatus } from "../types";
import { StatusPill } from "../components/StatusPill";

interface TrackerProps {
  applications: Application[];
  onUpdate: (id: string, status: ApplicationStatus, notes?: string) => void;
}

const stages: Array<{ id: ApplicationStatus; label: string }> = [
  { id: "approved", label: "Approved" },
  { id: "needs_review", label: "Needs review" },
  { id: "blocked", label: "Blocked" },
  { id: "failed", label: "Failed" },
  { id: "applied", label: "Applied" },
  { id: "viewed", label: "Viewed" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "rejected", label: "Rejected" },
  { id: "archived", label: "Archived" },
];

function stageTone(status: ApplicationStatus): "neutral" | "success" | "warning" | "error" | "accent" {
  if (status === "applied" || status === "interview" || status === "offer" || status === "viewed") return "success";
  if (status === "approved") return "accent";
  if (status === "blocked" || status === "needs_review") return "warning";
  if (status === "failed" || status === "rejected" || status === "archived") return "error";
  return "neutral";
}

export function Tracker({ applications, onUpdate }: TrackerProps) {
  const [selected, setSelected] = useState<Application | null>(applications.find((app) => app.status === "applied") || applications[0] || null);
  const [portalFilter, setPortalFilter] = useState("all");
  const [activeStage, setActiveStage] = useState<ApplicationStatus>("applied");
  const [query, setQuery] = useState("");
  const portals = useMemo(() => Array.from(new Set(applications.map((app) => app.portal))), [applications]);

  const filtered = applications.filter((app) => {
    const portalMatch = portalFilter === "all" || app.portal === portalFilter;
    const stageMatch = app.status === activeStage;
    const queryMatch = query.trim().length === 0 || `${app.title} ${app.company} ${app.portal}`.toLowerCase().includes(query.toLowerCase());
    return portalMatch && stageMatch && queryMatch;
  });

  const currentSelected = selected && filtered.some((app) => app.id === selected.id) ? selected : filtered[0] || selected;

  return (
    <>
      <section className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Application tracker</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Track outcomes without losing context.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
            <Metric label="Applied" value={applications.filter((app) => app.status === "applied").length} />
            <Metric label="Interviews" value={applications.filter((app) => app.status === "interview").length} tone="success" />
            <Metric label="Warnings" value={applications.filter((app) => app.warning).length} tone="warning" />
          </div>
        </div>
      </section>

      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-3">
        <label className="text-sm">
          Portal
          <select value={portalFilter} onChange={(event) => setPortalFilter(event.target.value)} className="terminal-field mt-1 h-9 rounded-md px-3">
            <option value="all">All portals</option>
            {portals.map((portal) => (
              <option key={portal} value={portal}>{portal}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Status
          <select value={activeStage} onChange={(event) => setActiveStage(event.target.value as ApplicationStatus)} className="terminal-field mt-1 h-9 rounded-md px-3">
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Date
          <input type="date" className="terminal-field mt-1 h-9 rounded-md px-3" />
        </label>
        <label className="min-w-[240px] flex-1 text-sm">
          Company
          <div className="relative mt-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="terminal-field h-9 w-full rounded-md pl-9 pr-3" placeholder="Search applications" />
          </div>
        </label>
      </section>

      <section className="mb-4 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 scrollbar-thin">
        <div className="flex min-w-max gap-1">
          {stages.map((stage) => {
            const count = applications.filter((app) => app.status === stage.id).length;
            const active = activeStage === stage.id;
            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setActiveStage(stage.id)}
                className={`flex min-w-32 items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                  active ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                }`}
              >
                <span>{stage.label}</span>
                <span className="rounded-full bg-[var(--bg-surface)] px-2 py-0.5 text-xs">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {applications.filter((app) => app.warning).length > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-muted)]">
          <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} />
          {applications.filter((app) => app.warning).length} applications need portal review.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="air-surface overflow-hidden rounded-lg">
          <div className="border-b border-[var(--border-default)] px-4 py-3">
            <h2 className="text-base font-semibold">Applications</h2>
            <p className="text-xs text-[var(--text-muted)]">{filtered.length} records in {stages.find((stage) => stage.id === activeStage)?.label}</p>
          </div>
          <div>
            {filtered.length === 0 ? (
              <div className="p-6 text-sm text-[var(--text-muted)]">No applications match the current filters.</div>
            ) : (
              filtered.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => setSelected(app)}
                  className={`air-row grid w-full gap-3 px-4 py-4 text-left transition hover:bg-[var(--bg-elevated)] md:grid-cols-[1fr_120px_90px_130px] ${
                    currentSelected?.id === app.id ? "bg-[var(--bg-elevated)]" : "bg-[var(--bg-surface)]"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{app.title}</p>
                    <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{app.company} - {app.location}</p>
                  </div>
                  <div className="flex items-center">
                    <StatusPill label={app.portal} tone="neutral" />
                  </div>
                  <div className="flex items-center">
                    <span className="rounded-md border border-[var(--border-default)] px-2 py-1 text-xs font-semibold" style={{ color: app.score >= 80 ? "var(--score-high)" : app.score >= 60 ? "var(--score-mid)" : "var(--score-low)" }}>
                      {app.score}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <StatusPill label={app.status} tone={stageTone(app.status)} />
                    {app.warning ? <AlertTriangle size={15} style={{ color: "var(--state-warning)" }} /> : <CheckCircle size={15} style={{ color: "var(--state-success)" }} />}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <ApplicationDetails application={currentSelected} onUpdate={onUpdate} />
      </div>
    </>
  );
}

function ApplicationDetails({ application, onUpdate }: { application?: Application | null; onUpdate: TrackerProps["onUpdate"] }) {
  const [status, setStatus] = useState<ApplicationStatus>(application?.status || "fetched");
  const [notes, setNotes] = useState(application?.notes || "");

  useEffect(() => {
    if (!application) return;
    setStatus(application.status);
    setNotes(application.notes);
  }, [application]);

  if (!application) {
    return (
      <aside className="air-surface rounded-lg p-4">
        <p className="text-sm text-[var(--text-muted)]">Select an application to inspect its status, response, and notes.</p>
      </aside>
    );
  }

  return (
    <aside className="air-surface rounded-lg p-4 xl:sticky xl:top-24 xl:self-start">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Application details</p>
          <h2 className="mt-2 text-xl font-semibold">{application.title}</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{application.company} - {application.portal}</p>
        </div>
        <button type="button" aria-label="Close details" title="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-default)]">
          <X size={15} />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Info label="Score" value={`${application.score}`} />
        <Info label="Latest update" value={application.latestDate} />
        <Info label="Location" value={application.location} />
        <Info label="Resume version" value={application.resumeVersion} />
      </div>

      <section className="mt-5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
        <p className="text-sm font-semibold">Timeline</p>
        <ol className="mt-3 space-y-3 text-sm text-[var(--text-muted)]">
          {["Fetched and scored", "User reviewed action", application.status === "applied" ? "Applied successfully" : "Current status updated", `Latest state on ${application.latestDate}`].map((item) => (
            <li key={item} className="flex gap-2">
              <Clock size={14} className="mt-0.5" />
              {item}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-5 rounded-lg border border-[var(--border-default)] p-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText size={15} />
          Apply response
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{application.applyResponse}</p>
      </section>

      {application.warning && (
        <p className="mt-4 flex gap-2 rounded-lg bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
          <AlertTriangle size={16} style={{ color: "var(--state-warning)" }} />
          {application.warning}
        </p>
      )}

      <label className="mt-5 block text-sm">
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

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="air-button h-10 border border-[var(--border-default)] px-3 text-[var(--text-muted)]">Close</button>
        <button type="button" onClick={() => onUpdate(application.id, status, notes)} className="air-button h-10 bg-[var(--accent-primary)] px-4 text-white hover:bg-[var(--accent-hover)]">
          Update
        </button>
      </div>
    </aside>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-default)] p-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: "success" | "warning" }) {
  return (
    <div className="min-w-24 px-3 py-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: tone === "success" ? "var(--state-success)" : tone === "warning" ? "var(--state-warning)" : "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}
