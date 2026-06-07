import { AlertTriangle, CheckCircle, ExternalLink, Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StatusPill } from "../components/StatusPill";
import { apiErrorMessage, companyAccountsAPI, portalsAPI } from "../api/client";
import { formatDate } from "../api/mappers";

type PortalState = {
  key: string;
  name: string;
  kind: "Public" | "Login" | "Token" | "Browser";
  status: "public" | "connected" | "connecting" | "expired" | "manual" | "not_connected";
  checked: string;
  profile?: string;
};

type ConnectSession = {
  connection_id: string;
  state: "idle" | "starting" | "waiting_for_login" | "connected" | "failed" | "expired";
  message: string;
  profile_id?: string;
};

const basePortals: PortalState[] = [
  {
    key: "naukri",
    name: "Naukri",
    kind: "Login",
    status: "not_connected",
    checked: "Not connected",
    profile: "Sign in once to enable personalized recommendations and apply. Hunter keeps the session refreshed; public search works either way.",
  },
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
const tabs = ["Portals", "Preferences", "Apply Safety", "Resume"];

function statusLabel(status: PortalState["status"]) {
  return {
    public: "Public search",
    connected: "Connected",
    connecting: "Connecting",
    expired: "Expired",
    manual: "Manual login",
    not_connected: "Not connected",
  }[status];
}

function statusTone(status: PortalState["status"]): "success" | "warning" | "neutral" {
  if (status === "public" || status === "connected") return "success";
  if (status === "connecting" || status === "expired" || status === "manual") return "warning";
  return "neutral";
}

function isActiveConnect(session: ConnectSession | null) {
  return session?.state === "starting" || session?.state === "waiting_for_login";
}

export function Portals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [portals, setPortals] = useState(basePortals);
  const [activePortal, setActivePortal] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [profileDraft, setProfileDraft] = useState("");
  const [companyAccounts, setCompanyAccounts] = useState<Record<string, string>>({});
  const [companyDraft, setCompanyDraft] = useState({ company: "", username: "", password: "" });
  const [naukriConnect, setNaukriConnect] = useState<ConnectSession | null>(null);
  const [naukriCreds, setNaukriCreds] = useState({ username: "", password: "" });
  const [naukriSaving, setNaukriSaving] = useState(false);
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
          if (portal.key === "naukri") {
            const expiredNaukri = Boolean(row.requires_reconnect) || String(row.connection_status) === "expired";
            return {
              ...portal,
              status: expiredNaukri ? "expired" : "connected",
              checked: expiredNaukri ? "Sign in again" : row.username ? `Signed in as ${row.username}` : "Login saved",
              profile: row.status_message || portal.profile,
            };
          }
          const connectionStatus = String(row.connection_status || "connected");
          const expired = Boolean(row.requires_reconnect) || connectionStatus === "expired";
          return {
            ...portal,
            status: expired ? "expired" : "connected",
            checked: expired ? "Reconnect needed" : formatDate(row.last_checked_at || row.created_at),
            profile: row.status_message || (row.profile_id ? "Profile captured" : row.chrome_profile_path ? "Browser session saved" : "Connected"),
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

  useEffect(() => {
    if (!isActiveConnect(naukriConnect) || !naukriConnect?.connection_id) return;

    const timer = window.setInterval(() => {
      void pollNaukriConnect(naukriConnect.connection_id);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [naukriConnect?.connection_id, naukriConnect?.state]);

  const saveNaukriCredentials = async () => {
    if (!naukriCreds.username.trim() || !naukriCreds.password) {
      setMessage("Enter your Naukri email and password to sign in.");
      return;
    }
    setNaukriSaving(true);
    setMessage("Signing in to Naukri...");
    try {
      const response = await portalsAPI.saveNaukriCredentials(naukriCreds.username.trim(), naukriCreds.password);
      setNaukriCreds({ username: "", password: "" });
      setActivePortal(null);
      setMessage(`Naukri connected as ${response.data?.username || "your account"}. Hunter keeps this session refreshed automatically.`);
      await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not sign in to Naukri."));
    } finally {
      setNaukriSaving(false);
    }
  };

  const disconnectNaukri = async () => {
    if (!window.confirm("Disconnect Naukri? Your saved credentials and session will be removed.")) return;
    try {
      await portalsAPI.disconnectNaukri();
      setMessage("Naukri disconnected. Public search still works.");
      await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not disconnect Naukri."));
    }
  };

  const startNaukriConnect = async () => {
    setMessage("Opening Naukri login. Search still works without this; use the browser window only if you want to save a Naukri session.");
    try {
      const response = await portalsAPI.startNaukriConnect();
      const connection = response.data?.connection as ConnectSession;
      setNaukriConnect(connection);
      setActivePortal(null);
      if (connection?.message) setMessage(connection.message);
      if (connection?.state === "connected") await loadPortalStatus();
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not start Naukri browser login."));
    }
  };

  const pollNaukriConnect = async (connectionId: string) => {
    try {
      const response = await portalsAPI.getNaukriConnectStatus(connectionId);
      const connection = response.data?.connection as ConnectSession;
      setNaukriConnect(connection);
      if (connection?.state === "connected") {
        setMessage("Naukri browser login saved. Jobs search still uses the public search path by default.");
        await loadPortalStatus();
      } else if (connection?.state === "failed" || connection?.state === "expired") {
        setMessage(connection.message || "Naukri browser login did not complete.");
      }
    } catch (caught) {
      setMessage(apiErrorMessage(caught, "Could not check Naukri browser login status."));
    }
  };

  useEffect(() => {
    if (searchParams.get("connect") !== "naukri" || isActiveConnect(naukriConnect)) return;
    setSearchParams({}, { replace: true });
    void startNaukriConnect();
  }, [naukriConnect?.state, searchParams, setSearchParams]);

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
            <Metric label="Public/manual" value={portals.filter((portal) => portal.status === "public" || portal.status === "manual").length} />
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
            <p className="text-xs text-[var(--text-muted)]">Naukri search works publicly. Browser login is optional and does not block search.</p>
          </div>
          <div>
            {portals.map((portal) => {
              const isNaukri = portal.key === "naukri";
              const isConnecting = isNaukri && isActiveConnect(naukriConnect);
              const displayStatus = isConnecting ? "connecting" : portal.status;
              const displayChecked = isConnecting
                ? naukriConnect?.state === "starting" ? "Launching browser" : "Waiting for login"
                : portal.checked;
              const displayProfile = isConnecting
                ? naukriConnect?.message || "Starting Naukri browser session..."
                : portal.profile || "Secrets hidden after save";

              return (
                <div key={portal.key} className="air-row px-4 py-4">
                  <div className="grid gap-3 lg:grid-cols-[1fr_100px_140px_140px_190px] lg:items-center">
                    <div>
                      <p className="text-sm font-semibold">{portal.name}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">{displayProfile}</p>
                    </div>
                    <span className="text-sm text-[var(--text-muted)]">{portal.kind}</span>
                    <StatusPill label={statusLabel(displayStatus)} tone={statusTone(displayStatus)} />
                    <span className="text-sm text-[var(--text-muted)]">{displayChecked}</span>
                    <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                      {isNaukri ? (
                        <>
                          <button type="button" onClick={() => setActivePortal(activePortal === "naukri" ? null : "naukri")} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-primary)]">
                            <ExternalLink size={14} />
                            {portal.status === "expired" ? "Sign in again" : portal.status === "connected" ? "Reconnect" : "Sign in"}
                          </button>
                          <span className="inline-flex h-9 items-center rounded-md border border-[var(--border-default)] px-3 text-sm font-medium text-[var(--text-muted)]">
                            Search works
                          </span>
                        </>
                      ) : portal.kind === "Token" ? (
                        <button type="button" onClick={() => setActivePortal(activePortal === portal.key ? null : portal.key)} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-primary)]">
                          <ExternalLink size={14} />
                          {portal.status === "connected" ? "Update" : "Manual setup"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => confirmBrowserPortal(portal)} className="air-button h-9 border border-[var(--border-default)] px-3 text-[var(--text-primary)]">
                          <ExternalLink size={14} />
                          Confirm
                        </button>
                      )}
                      {isNaukri && (portal.status === "connected" || portal.status === "expired") && (
                        <button type="button" onClick={disconnectNaukri} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-muted)]" aria-label="Disconnect Naukri" title="Disconnect">
                          <Trash2 size={14} />
                        </button>
                      )}
                      {!isNaukri && portal.status === "connected" && (
                        <button type="button" onClick={() => removePortal(portal)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-muted)]" aria-label={`Remove ${portal.name}`} title="Remove">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {activePortal === "naukri" && isNaukri && (
                    <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
                      <div className="mb-3">
                        <p className="text-sm font-semibold">Sign in to Naukri</p>
                        <p className="text-xs text-[var(--text-muted)]">Your password is encrypted and never shown again. Hunter re-signs in automatically when the Naukri session expires, so you stay connected until you change your password.</p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input value={naukriCreds.username} onChange={(event) => setNaukriCreds((current) => ({ ...current, username: event.target.value }))} placeholder="Naukri email" autoComplete="username" className="terminal-field h-9 rounded-md px-3 text-sm" />
                        <input value={naukriCreds.password} onChange={(event) => setNaukriCreds((current) => ({ ...current, password: event.target.value }))} placeholder="Naukri password" type="password" autoComplete="current-password" className="terminal-field h-9 rounded-md px-3 text-sm" />
                        <button type="button" onClick={saveNaukriCredentials} disabled={naukriSaving} className="air-button h-9 bg-[var(--accent-primary)] px-3 text-white disabled:cursor-wait disabled:opacity-70">
                          {naukriSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          {naukriSaving ? "Signing in" : "Sign in"}
                        </button>
                      </div>
                      <button type="button" onClick={startNaukriConnect} disabled={isConnecting} className="mt-3 text-xs text-[var(--text-muted)] underline underline-offset-2 disabled:opacity-70">
                        {isConnecting ? (naukriConnect?.state === "starting" ? "Opening browser..." : "Waiting for login...") : "Advanced: use a browser login window instead"}
                      </button>
                    </div>
                  )}

                  {activePortal === portal.key && portal.kind === "Token" && (
                    <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
                      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">Advanced manual setup</p>
                          <p className="text-xs text-[var(--text-muted)]">Use this only when guided connection cannot capture the portal session.</p>
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input value={profileDraft} onChange={(event) => setProfileDraft(event.target.value)} placeholder={portal.key === "naukri" ? "Profile ID" : "Foundit user id"} className="terminal-field h-9 rounded-md px-3 text-sm" />
                        <input value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Bearer token (hidden after save)" type="password" className="terminal-field h-9 rounded-md px-3 text-sm" />
                        <button type="button" onClick={() => saveTokenPortal(portal)} className="air-button h-9 bg-[var(--accent-primary)] px-3 text-white">
                          <Save size={14} />
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
