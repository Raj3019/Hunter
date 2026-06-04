import { AlertTriangle, CheckCircle, ExternalLink, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusPill } from "../components/StatusPill";
import { apiErrorMessage, companyAccountsAPI, portalsAPI } from "../api/client";
import { formatDate } from "../api/mappers";

type PortalState = {
  key: string;
  name: string;
  kind: "Token" | "Browser";
  status: "connected" | "expired" | "manual" | "not_connected";
  checked: string;
  profile?: string;
};

const basePortals: PortalState[] = [
  { key: "naukri", name: "Naukri", kind: "Token", status: "not_connected", checked: "Not connected" },
  { key: "foundit", name: "Foundit", kind: "Token", status: "not_connected", checked: "Not connected" },
  { key: "internshala", name: "Internshala", kind: "Browser", status: "manual", checked: "Manual session" },
  { key: "linkedin", name: "LinkedIn", kind: "Browser", status: "manual", checked: "Manual session" },
  { key: "workday", name: "Workday", kind: "Browser", status: "manual", checked: "Manual session" },
  { key: "taleo", name: "Taleo", kind: "Browser", status: "manual", checked: "Manual session" },
];

const companies = [
  { key: "tcs", name: "TCS" },
  { key: "infosys", name: "Infosys" },
  { key: "cognizant", name: "Cognizant" },
  { key: "wipro", name: "Wipro" },
  { key: "hcl", name: "HCL" },
];
const tabs = ["Portals", "Preferences", "Apply Safety", "Resume", "AI Provider"];

function statusLabel(status: PortalState["status"]) {
  return {
    connected: "Connected",
    expired: "Expired",
    manual: "Manual login",
    not_connected: "Not connected",
  }[status];
}

function statusTone(status: PortalState["status"]): "success" | "warning" | "neutral" {
  if (status === "connected") return "success";
  if (status === "expired" || status === "manual") return "warning";
  return "neutral";
}

export function Portals() {
  const [portals, setPortals] = useState(basePortals);
  const [activePortal, setActivePortal] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [profileDraft, setProfileDraft] = useState("");
  const [companyAccounts, setCompanyAccounts] = useState<Record<string, string>>({});
  const [companyDraft, setCompanyDraft] = useState({ company: "", username: "", password: "" });
  const [message, setMessage] = useState("");

  const loadPortalStatus = async () => {
    try {
      const [portalResponse, accountsResponse] = await Promise.all([
        portalsAPI.getStatus(),
        companyAccountsAPI.getAll(),
      ]);
      const livePortals = portalResponse.data?.portals || {};
      setPortals(
        basePortals.map((portal) => {
          const row = livePortals[portal.key];
          if (!row) return portal;
          return {
            ...portal,
            status: "connected",
            checked: formatDate(row.created_at),
            profile: row.profile_id || row.chrome_profile_path || "Connected",
          };
        })
      );
      const accounts: Record<string, string> = {};
      for (const account of accountsResponse.data?.accounts || []) {
        if (account.company_key) accounts[account.company_key] = account.username || "Saved";
      }
      setCompanyAccounts(accounts);
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not load portal status."));
    }
  };

  useEffect(() => {
    void loadPortalStatus();
  }, []);

  const saveTokenPortal = async (portal: PortalState) => {
    if (!tokenDraft || !profileDraft) {
      setMessage("Enter both profile id and bearer token before saving.");
      return;
    }

    try {
      if (portal.key === "naukri") {
        await portalsAPI.saveNaukriToken(tokenDraft, profileDraft);
      } else if (portal.key === "foundit") {
        await portalsAPI.saveFounditToken(tokenDraft, profileDraft);
      } else {
        setMessage(`${portal.name} does not have a token save route yet.`);
        return;
      }

      setMessage(`${portal.name} connected. Token value is hidden after save.`);
      setTokenDraft("");
      setProfileDraft("");
      setActivePortal(null);
      await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, `Could not connect ${portal.name}.`));
    }
  };

  const confirmBrowserPortal = async (portal: PortalState) => {
    try {
      if (portal.key !== "linkedin") {
        setMessage(`${portal.name} browser setup route is not available yet. LinkedIn can be confirmed from this page.`);
        return;
      }
      await portalsAPI.confirmLinkedIn();
      setMessage(`${portal.name} browser session marked ready.`);
      await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, `Could not confirm ${portal.name}.`));
    }
  };

  const removePortal = (portal: PortalState) => {
    setMessage(`Disconnect route for ${portal.name} is not implemented yet.`);
  };

  const saveCompany = async () => {
    if (!companyDraft.company || !companyDraft.username || !companyDraft.password) {
      setMessage("Choose a company and enter username/password to save.");
      return;
    }
    try {
      await companyAccountsAPI.save(companyDraft.company, companyDraft.username, companyDraft.password);
      setCompanyDraft({ company: "", username: "", password: "" });
      setMessage("Company account saved. Password is encrypted by the backend and never shown here.");
      await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not save company account."));
    }
  };

  const deleteCompany = async (companyKey: string) => {
    if (!window.confirm("Remove this saved company account?")) return;
    try {
      await companyAccountsAPI.delete(companyKey);
      setMessage("Company account removed.");
      await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not remove company account."));
    }
  };

  return (
    <>
      <section className="mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Portal connections</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Manage job boards and company accounts without exposing secrets.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
            <Metric label="Connected" value={portals.filter((portal) => portal.status === "connected").length} tone="success" />
            <Metric label="Expired" value={portals.filter((portal) => portal.status === "expired").length} tone="warning" />
            <Metric label="Manual" value={portals.filter((portal) => portal.status === "manual").length} />
          </div>
        </div>
        {message && <p className="mt-4 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-muted)]">{message}</p>}
      </section>

      <nav className="mb-4 overflow-x-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1 scrollbar-thin">
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <button key={tab} type="button" className={`rounded-md px-3 py-2 text-sm font-medium ${tab === "Portals" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]"}`}>
              {tab}
            </button>
          ))}
        </div>
      </nav>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="air-surface overflow-hidden rounded-lg">
          <div className="border-b border-[var(--border-default)] px-4 py-3">
            <h2 className="text-base font-semibold">Portal status</h2>
            <p className="text-xs text-[var(--text-muted)]">Tokens and browser sessions are hidden after save.</p>
          </div>
          <div>
            {portals.map((portal) => (
              <div key={portal.key} className="air-row px-4 py-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_100px_140px_140px_150px] lg:items-center">
                  <div>
                    <p className="text-sm font-semibold">{portal.name}</p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">{portal.profile || "Secrets hidden after save"}</p>
                  </div>
                  <span className="text-sm text-[var(--text-muted)]">{portal.kind}</span>
                  <StatusPill label={statusLabel(portal.status)} tone={statusTone(portal.status)} />
                  <span className="text-sm text-[var(--text-muted)]">{portal.checked}</span>
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    {portal.kind === "Token" ? (
                      <button type="button" onClick={() => setActivePortal(activePortal === portal.key ? null : portal.key)} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-primary)]">
                        <ExternalLink size={14} />
                        {portal.status === "connected" ? "Update" : "Connect"}
                      </button>
                    ) : (
                      <button type="button" onClick={() => confirmBrowserPortal(portal)} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-primary)]">
                        <ExternalLink size={14} />
                        Confirm
                      </button>
                    )}
                    {portal.status === "connected" && (
                      <button type="button" onClick={() => removePortal(portal)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-muted)]" aria-label={`Remove ${portal.name}`} title="Remove">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {activePortal === portal.key && portal.kind === "Token" && (
                  <div className="mt-4 grid gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 sm:grid-cols-[1fr_1fr_auto]">
                    <input value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} placeholder={portal.key === "naukri" ? "Profile ID" : "Foundit user id"} className="terminal-field h-9 rounded-md px-3 text-sm" />
                    <input value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Bearer token (hidden after save)" type="password" className="terminal-field h-9 rounded-md px-3 text-sm" />
                    <button type="button" onClick={() => saveTokenPortal(portal)} className="air-button h-9 bg-[var(--accent-primary)] px-3 text-white">
                      <Save size={14} />
                      Save
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="air-surface rounded-lg p-4">
            <h2 className="text-base font-semibold">Company accounts</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Passwords are encrypted by the backend and never displayed.</p>
            <div className="mt-4 grid gap-3">
              <select value={companyDraft.company} onChange={(event) => setCompanyDraft((current) => ({ ...current, company: event.target.value }))} className="terminal-field h-10 rounded-md px-3">
                <option value="">Company</option>
                {companies.map((company) => <option key={company.key} value={company.key}>{company.name}</option>)}
              </select>
              <input value={companyDraft.username} onChange={(event) => setCompanyDraft((current) => ({ ...current, username: event.target.value }))} placeholder="Username or email" className="terminal-field h-10 rounded-md px-3" />
              <input value={companyDraft.password} onChange={(event) => setCompanyDraft((current) => ({ ...current, password: event.target.value }))} placeholder="Password" type="password" className="terminal-field h-10 rounded-md px-3" />
              <button type="button" onClick={saveCompany} className="air-button h-10 bg-[var(--accent-primary)] px-3 text-white">Save account</button>
            </div>
          </section>

          <section className="air-surface rounded-lg p-4">
            <h2 className="text-base font-semibold">Saved accounts</h2>
            <div className="mt-4 space-y-3">
              {companies.map((company) => (
                <div key={company.key} className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] pb-3 last:border-b-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium">{company.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{companyAccounts[company.key] ? `Saved as ${companyAccounts[company.key]}` : "Not connected"}</p>
                  </div>
                  {companyAccounts[company.key] ? (
                    <button type="button" onClick={() => deleteCompany(company.key)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-muted)]" aria-label={`Remove ${company.name}`} title="Remove">
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">Optional</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <section className="mt-5 flex flex-wrap gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3 text-sm text-[var(--text-muted)]">
        <span className="inline-flex items-center gap-2"><CheckCircle size={15} style={{ color: "var(--state-success)" }} /> Status loaded from backend</span>
        <span className="inline-flex items-center gap-2"><ShieldCheck size={15} style={{ color: "var(--state-success)" }} /> Apply checks active</span>
        <span className="inline-flex items-center gap-2"><CheckCircle size={15} style={{ color: "var(--state-success)" }} /> Secrets hidden</span>
        {portals.some((portal) => portal.status !== "connected") && <span className="inline-flex items-center gap-2"><AlertTriangle size={15} style={{ color: "var(--state-warning)" }} /> Some portals need setup</span>}
      </section>
    </>
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
