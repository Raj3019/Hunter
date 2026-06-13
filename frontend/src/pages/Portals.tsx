import { Building2, Download, ExternalLink, FileText, Globe, Link2, Lock, Plus, RefreshCw, Save, ShieldCheck, Trash2, User } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { StatusPill } from "../components/StatusPill";
import { Spinner } from "../components/ui/spinner";
import { useToast } from "../components/Toast";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusButton } from "@/components/ui/status-button";
import { PortalLogo } from "@/components/ui/PlatformLogos";
import { usePageLoading } from "@/components/PageLoadingContext";
import { currentUserEmail, currentUserName } from "@/lib/session";
import { apiErrorMessage, companyAccountsAPI, portalsAPI, CAREER_PORTAL_KEYS } from "../api/client";
import { formatDate } from "../api/mappers";

type PortalState = {
  key: string;
  name: string;
  kind: "Public" | "Login" | "Token" | "Browser";
  status: "public" | "connected" | "connecting" | "expired" | "manual" | "not_connected";
  checked: string;
  profile?: string;
};

const basePortals: PortalState[] = [
  { key: "naukri", name: "Naukri", kind: "Login", status: "not_connected", checked: "Not connected", profile: "Sign in once to enable personalized recommendations and apply. Public search works either way." },
  { key: "foundit", name: "Foundit", kind: "Login", status: "not_connected", checked: "Not connected", profile: "Sign in once so Hunter keeps the session refreshed and auto-tracks which jobs you've applied to." },
  { key: "wipro", name: "Wipro", kind: "Login", status: "not_connected", checked: "Not connected", profile: "Sign in to your Wipro careers account so Hunter auto-detects which Wipro jobs you've applied to." },
  { key: "hcltech", name: "HCLTech", kind: "Login", status: "not_connected", checked: "Not connected", profile: "Sign in to your HCLTech careers account so Hunter auto-detects which HCLTech jobs you've applied to." },
  { key: "infosys", name: "Infosys", kind: "Login", status: "not_connected", checked: "Not connected", profile: "Sign in to your Infosys careers account so Hunter auto-detects which Infosys jobs you've applied to." },
  { key: "capgemini", name: "Capgemini", kind: "Login", status: "not_connected", checked: "Not connected", profile: "Sign in to your Capgemini careers account so Hunter auto-detects which Capgemini jobs you've applied to." },
  { key: "internshala", name: "Internshala", kind: "Browser", status: "manual", checked: "Manual tracking", profile: "Manual tracking — Internshala's login is CAPTCHA-protected. Log in to open jobs, then mark them Applied in the Tracker." },
  { key: "workday", name: "Workday", kind: "Browser", status: "manual", checked: "Manual session" },
  { key: "taleo", name: "Taleo", kind: "Browser", status: "manual", checked: "Manual session" },
];

const companies = [
  { key: "tcs", name: "TCS" },
  { key: "cognizant", name: "Cognizant" },
];

const CAREER_LABELS: Record<string, string> = { wipro: "Wipro", hcltech: "HCLTech", infosys: "Infosys", capgemini: "Capgemini" };
const BROWSER_PORTAL_KEYS = ["internshala"];
const PORTAL_LOGIN_URLS: Record<string, string> = {
  internshala: "https://internshala.com/login",
  naukri: "https://www.naukri.com/nlogin/login",
  foundit: "https://www.foundit.in/seeker/login",
};

const TABS = [
  { key: "PORTALS", label: "Portals", icon: Link2 },
  { key: "SAFETY", label: "Apply Safety", icon: ShieldCheck },
  { key: "RESUME", label: "Resume", icon: FileText },
  { key: "ACCOUNT", label: "Account", icon: User },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function statusLabel(status: PortalState["status"]) {
  return { public: "Public search", connected: "Connected", connecting: "Connecting", expired: "Expired", manual: "Manual login", not_connected: "Not connected" }[status];
}

function statusTone(status: PortalState["status"]): "success" | "warning" | "neutral" {
  if (status === "public" || status === "connected") return "success";
  if (status === "connecting" || status === "expired" || status === "manual") return "warning";
  return "neutral";
}

export function Portals() {
  const [portals, setPortals] = useState(basePortals);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("PORTALS");
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [companyAccounts, setCompanyAccounts] = useState<Record<string, string>>({});
  const [companyDraft, setCompanyDraft] = useState({ company: "", username: "", password: "" });
  const [naukriCreds, setNaukriCreds] = useState({ username: "", password: "" });
  const [naukriSaving, setNaukriSaving] = useState(false);
  const [founditCreds, setFounditCreds] = useState({ username: "", password: "" });
  const [founditSaving, setFounditSaving] = useState(false);
  const [careerCreds, setCareerCreds] = useState<Record<string, { username: string; password: string }>>({});
  const [careerSaving, setCareerSaving] = useState<Record<string, boolean>>({});
  const toast = useToast();
  const setPageLoading = usePageLoading();

  const byKey = (k: string) => portals.find((p) => p.key === k) || basePortals.find((p) => p.key === k)!;
  const careerCredFor = (key: string) => careerCreds[key] || { username: "", password: "" };

  const loadPortalStatus = async () => {
    try {
      const [portalResponse, accountsResponse] = await Promise.all([portalsAPI.getStatus(), companyAccountsAPI.getAll()]);
      const livePortals = portalResponse.data?.portals || {};
      setPortals(
        basePortals.map((portal) => {
          if (BROWSER_PORTAL_KEYS.includes(portal.key)) {
            return { ...portal, status: "manual", checked: "Manual tracking" };
          }
          const row = livePortals[portal.key];
          if (!row) return portal;
          if (portal.key === "naukri" || portal.key === "foundit" || CAREER_PORTAL_KEYS.includes(portal.key)) {
            const expired = Boolean(row.requires_reconnect) || String(row.connection_status) === "expired";
            return { ...portal, status: expired ? "expired" : "connected", checked: expired ? "Sign in again" : row.username ? `${row.username}` : "Login saved", profile: row.status_message || portal.profile };
          }
          const expired = Boolean(row.requires_reconnect) || String(row.connection_status || "connected") === "expired";
          return { ...portal, status: expired ? "expired" : "connected", checked: expired ? "Reconnect needed" : formatDate(row.last_checked_at || row.created_at), profile: row.status_message || portal.profile };
        })
      );
      const accounts: Record<string, string> = {};
      for (const account of accountsResponse.data?.accounts || []) {
        if (account.company_key) accounts[account.company_key] = account.username || "Saved";
      }
      setCompanyAccounts(accounts);
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not load portal status."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPortalStatus();
  }, []);

  useLayoutEffect(() => {
    if (!loading) {
      setPageLoading(null);
      return;
    }
    setPageLoading({
      title: "Loading portal connections...",
      description: "Checking saved sessions and company accounts.",
    });
    return () => setPageLoading(null);
  }, [loading, setPageLoading]);

  const saveNaukriCredentials = async () => {
    if (!naukriCreds.username.trim() || !naukriCreds.password) {
      toast.error("Enter your Naukri email and password to sign in.");
      return;
    }
    setNaukriSaving(true);
    try {
      const response = await portalsAPI.saveNaukriCredentials(naukriCreds.username.trim(), naukriCreds.password);
      setNaukriCreds({ username: "", password: "" });
      toast.success(`Naukri connected as ${response.data?.username || "your account"}. Hunter keeps this session refreshed automatically.`);
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not sign in to Naukri."));
      throw caught;
    } finally {
      setNaukriSaving(false);
    }
  };

  const disconnectNaukri = async () => {
    if (!window.confirm("Disconnect Naukri? Your saved credentials and session will be removed.")) return;
    try {
      await portalsAPI.disconnectNaukri();
      toast.success("Naukri disconnected. Public search still works.");
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not disconnect Naukri."));
    }
  };

  const saveFounditCredentials = async () => {
    if (!founditCreds.username.trim() || !founditCreds.password) {
      toast.error("Enter your Foundit email and password to sign in.");
      return;
    }
    setFounditSaving(true);
    try {
      const response = await portalsAPI.saveFounditCredentials(founditCreds.username.trim(), founditCreds.password);
      setFounditCreds({ username: "", password: "" });
      toast.success(`Foundit connected as ${response.data?.username || "your account"}. Hunter keeps this session refreshed and tracks your applies automatically.`);
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not sign in to Foundit."));
      throw caught;
    } finally {
      setFounditSaving(false);
    }
  };

  const disconnectFoundit = async () => {
    if (!window.confirm("Disconnect Foundit? Your saved credentials and session will be removed.")) return;
    try {
      await portalsAPI.disconnectFoundit();
      toast.success("Foundit disconnected. Public search still works.");
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not disconnect Foundit."));
    }
  };

  const saveCareerCredentials = async (portalKey: string) => {
    const label = CAREER_LABELS[portalKey] || portalKey;
    const creds = careerCredFor(portalKey);
    if (!creds.username.trim() || !creds.password) {
      toast.error(`Enter your ${label} careers email and password to sign in.`);
      return;
    }
    setCareerSaving((current) => ({ ...current, [portalKey]: true }));
    try {
      const response = await portalsAPI.saveCareerCredentials(portalKey, creds.username.trim(), creds.password);
      setCareerCreds((current) => ({ ...current, [portalKey]: { username: "", password: "" } }));
      setActiveAccount(null);
      toast.success(`${label} connected as ${response.data?.username || "your account"}. Hunter signs in to auto-detect which ${label} jobs you've applied to.`);
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, `Could not sign in to ${label} careers.`));
    } finally {
      setCareerSaving((current) => ({ ...current, [portalKey]: false }));
    }
  };

  const disconnectCareer = async (portalKey: string) => {
    const label = CAREER_LABELS[portalKey] || portalKey;
    if (!window.confirm(`Disconnect ${label}? Your saved credentials will be removed.`)) return;
    try {
      await portalsAPI.disconnectCareer(portalKey);
      toast.success(`${label} disconnected.`);
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, `Could not disconnect ${label}.`));
    }
  };

  const openPortalLogin = (portal: PortalState) => {
    const url = PORTAL_LOGIN_URLS[portal.key];
    if (!url) {
      toast.info(`${portal.name} is a manual portal — log in on its own site, then mark applied jobs in Tracker.`);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
    toast.info(`Opened ${portal.name} in a new tab. Log in there to keep your session active.`);
  };

  const saveCompany = async () => {
    if (!companyDraft.company || !companyDraft.username || !companyDraft.password) {
      toast.error("Enter username/password to save.");
      return;
    }
    try {
      await companyAccountsAPI.save(companyDraft.company, companyDraft.username, companyDraft.password);
      setCompanyDraft({ company: "", username: "", password: "" });
      setActiveAccount(null);
      toast.success("Company account saved. Password is encrypted by the backend and never shown here.");
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not save company account."));
    }
  };

  const deleteCompany = async (companyKey: string) => {
    if (!window.confirm("Remove this saved company account?")) return;
    try {
      await companyAccountsAPI.delete(companyKey);
      toast.success("Company account removed.");
      await loadPortalStatus();
    } catch (caught) {
      toast.error(apiErrorMessage(caught, "Could not remove company account."));
    }
  };

  // Career portals + TCS/Cognizant company accounts — unified "career account" grid.
  const careerEntries = CAREER_PORTAL_KEYS.map((key) => ({ key, label: CAREER_LABELS[key] || key, type: "career" as const }));
  const companyEntries = companies.map((c) => ({ key: c.key, label: c.name, type: "company" as const }));
  const accountEntries = [...careerEntries, ...companyEntries];

  const browserPortals = ["internshala", "workday", "taleo"].map(byKey);

  return (
    <div className="animate-fade-in-slide space-y-6">
      {/* Header */}
      <Card className="space-y-1.5 rounded-2xl p-6">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-zinc-200/80 bg-zinc-100 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-tight text-zinc-800"><Link2 className="h-4 w-4 text-zinc-600" /> Connections & safety</span>
        <h1 className="font-display text-2xl font-black tracking-tight text-zinc-950">Portals & company accounts</h1>
        <p className="font-sans text-xs font-medium leading-relaxed text-zinc-500">Connect job portals and encrypted company accounts. Naukri runs as public search with no login required.</p>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-bold transition-all ${tab === t.key ? "border-brand-pine bg-brand-pine text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-brand-pine/40"}`}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "PORTALS" && loading && (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1].map((i) => (
              <Card key={i} className="space-y-3 rounded-2xl p-5">
                <div className="flex items-center justify-between"><div className="h-5 w-24 animate-pulse rounded bg-zinc-100" /><div className="h-5 w-20 animate-pulse rounded-full bg-zinc-100" /></div>
                <div className="h-9 animate-pulse rounded-xl bg-zinc-100" />
                <div className="h-9 animate-pulse rounded-xl bg-zinc-100" />
                <div className="h-9 animate-pulse rounded-xl bg-zinc-100" />
              </Card>
            ))}
          </div>
          <Card className="space-y-3 rounded-2xl p-5">
            <div className="h-4 w-40 animate-pulse rounded bg-zinc-100" />
            <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-zinc-100" />)}</div>
          </Card>
        </div>
      )}

      {tab === "PORTALS" && !loading && (
        <div className="space-y-5">
          {/* Login-based portals */}
          <div className="grid gap-4 md:grid-cols-2">
            {["naukri", "foundit"].map((key) => {
              const p = byKey(key);
              const isNaukri = key === "naukri";
              const creds = isNaukri ? naukriCreds : founditCreds;
              const setCreds = isNaukri ? setNaukriCreds : setFounditCreds;
              const saving = isNaukri ? naukriSaving : founditSaving;
              const onSave = isNaukri ? saveNaukriCredentials : saveFounditCredentials;
              const onDisconnect = isNaukri ? disconnectNaukri : disconnectFoundit;
              const connected = p.status === "connected";
              const expired = p.status === "expired";
              return (
                <Card key={key} className="space-y-3 rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <PortalLogo name={p.name} />
                    <StatusPill label={statusLabel(p.status)} tone={statusTone(p.status)} />
                  </div>

                  {connected ? (
                    <>
                      <p className="font-mono text-[10px] text-zinc-400">Session: <b className="text-zinc-700">{p.checked}</b></p>
                      <p className="text-xs leading-relaxed text-zinc-500">Connected and refreshing automatically. Public search works either way.</p>
                      <Button type="button" variant="outline" onClick={onDisconnect} className="h-9 w-full rounded-xl text-[11px] text-[var(--state-error)] hover:border-[var(--state-error)]">
                        <Trash2 className="h-4 w-4" /> Disconnect
                      </Button>
                    </>
                  ) : (
                    <>
                      {expired && <Alert variant="warning" className="rounded-lg px-3 py-2 text-[11px] [&>svg]:size-4">Session expired — sign in again to resume assisted sync.</Alert>}
                      <div className="space-y-2">
                        <Input type="email" placeholder="Portal email" autoComplete="username" value={creds.username} onChange={(e) => setCreds({ ...creds, username: e.target.value })} className="h-9 rounded-xl text-xs" />
                        <Input type="password" placeholder="Password (encrypted — never stored in plain text)" autoComplete="current-password" value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} className="h-9 rounded-xl text-xs" />
                      </div>
                      <div className="flex gap-2">
                        <StatusButton onClick={onSave} idleIcon={<Lock className="h-4 w-4 text-brand-clay" />} text={{ loading: "Validating…", success: "Connected", error: "Failed" }} className="h-9 flex-1 text-[11px]">
                          {expired ? "Reconnect" : "Save & validate"}
                        </StatusButton>
                        <Button type="button" variant="outline" onClick={() => openPortalLogin(p)} className="h-9 flex-1 rounded-xl text-[11px]">
                          <Globe className="h-4 w-4" /> Connect via browser
                        </Button>
                      </div>
                      {expired && (
                        <button type="button" onClick={onDisconnect} className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-[var(--state-error)]"><Trash2 className="h-3 w-3" /> Remove saved login</button>
                      )}
                    </>
                  )}
                </Card>
              );
            })}
          </div>

          {/* Browser-session portals */}
          <Card className="space-y-3 rounded-2xl p-5">
            <h3 className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">Browser-session portals</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {browserPortals.map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><PortalLogo name={p.name} size="badge" /><StatusPill label={statusLabel(p.status)} tone={statusTone(p.status)} /></div>
                    <p className="mt-0.5 font-mono text-[9px] text-zinc-400">Last checked: {p.checked}</p>
                  </div>
                  {PORTAL_LOGIN_URLS[p.key] ? (
                    <Button type="button" size="sm" onClick={() => openPortalLogin(p)} className="h-8 shrink-0 rounded-lg bg-brand-pine text-[11px] hover:bg-brand-pine-deep">Log in</Button>
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] font-bold text-zinc-400">Manual only</span>
                  )}
                </div>
              ))}
              {/* Naukri public search */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2"><PortalLogo name="naukri" size="badge" /><StatusPill label="Public search" tone="success" /></div>
                  <p className="mt-0.5 font-mono text-[9px] text-zinc-400">Last checked: always on</p>
                </div>
                <span className="shrink-0 font-mono text-[10px] font-bold text-sky-700">No login</span>
              </div>
            </div>
          </Card>

          {/* Company career accounts */}
          <Card className="space-y-3 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400"><Building2 className="h-4 w-4" /> Company career accounts (encrypted)</h3>
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[8px] font-bold uppercase text-violet-700"><Download className="h-3 w-3" /> Applied-status import</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accountEntries.map((acc) => {
                const connected = acc.type === "career" ? byKey(acc.key).status === "connected" || byKey(acc.key).status === "expired" : Boolean(companyAccounts[acc.key]);
                const username = acc.type === "career" ? byKey(acc.key).checked : companyAccounts[acc.key];
                const expanded = activeAccount === acc.key;
                const saving = acc.type === "career" ? Boolean(careerSaving[acc.key]) : false;
                return (
                  <div key={acc.key} className="rounded-2xl border border-zinc-200 bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <PortalLogo name={acc.label} size="badge" />
                        {connected ? (
                          <span className="mt-1 block truncate font-mono text-[9px] text-brand-pine">● {username}</span>
                        ) : (
                          <span className="mt-1 inline-flex items-center gap-1 font-mono text-[8px] font-bold text-zinc-400"><Download className="h-2.5 w-2.5" /> Import available</span>
                        )}
                      </div>
                      {connected ? (
                        <Button type="button" variant="outline" size="sm" onClick={() => (acc.type === "career" ? disconnectCareer(acc.key) : deleteCompany(acc.key))} className="h-8 shrink-0 rounded-lg text-[10px]">Remove</Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => { setActiveAccount(expanded ? null : acc.key); if (acc.type === "company") setCompanyDraft({ company: acc.key, username: "", password: "" }); }} className="h-8 shrink-0 rounded-lg bg-brand-pine text-[10px] hover:bg-brand-pine-deep"><Plus className="h-3.5 w-3.5 text-brand-clay" /> Add</Button>
                      )}
                    </div>
                    {expanded && !connected && (
                      <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
                        {acc.type === "career" ? (
                          <>
                            <Input placeholder={`${acc.label} careers email`} autoComplete="username" value={careerCredFor(acc.key).username} onChange={(e) => setCareerCreds((c) => ({ ...c, [acc.key]: { ...careerCredFor(acc.key), username: e.target.value } }))} className="h-9 rounded-xl text-xs" />
                            <Input type="password" placeholder="Password (encrypted)" autoComplete="current-password" value={careerCredFor(acc.key).password} onChange={(e) => setCareerCreds((c) => ({ ...c, [acc.key]: { ...careerCredFor(acc.key), password: e.target.value } }))} className="h-9 rounded-xl text-xs" />
                            <Button type="button" onClick={() => saveCareerCredentials(acc.key)} disabled={saving} className="h-9 w-full rounded-xl bg-brand-pine text-[11px] hover:bg-brand-pine-deep">{saving ? <Spinner className="size-4" /> : <Save className="h-4 w-4 text-brand-clay" />} Save & validate</Button>
                          </>
                        ) : (
                          <>
                            <Input placeholder="Username or email" autoComplete="username" value={companyDraft.username} onChange={(e) => setCompanyDraft((d) => ({ ...d, username: e.target.value }))} className="h-9 rounded-xl text-xs" />
                            <Input type="password" placeholder="Password (encrypted)" autoComplete="current-password" value={companyDraft.password} onChange={(e) => setCompanyDraft((d) => ({ ...d, password: e.target.value }))} className="h-9 rounded-xl text-xs" />
                            <Button type="button" onClick={saveCompany} className="h-9 w-full rounded-xl bg-brand-pine text-[11px] hover:bg-brand-pine-deep"><Save className="h-4 w-4 text-brand-clay" /> Save account</Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-zinc-400"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-clay" /> Passwords are encrypted with Fernet (AES-256) and never returned by the API. Connected career accounts let Hunter <b className="text-zinc-500">import the jobs you applied to</b> straight into your tracker.</p>
          </Card>
        </div>
      )}

      {tab === "SAFETY" && (
        <Card className="max-w-2xl space-y-5 rounded-2xl p-6">
          <div className="flex items-center gap-2 rounded-xl border border-brand-border bg-[#faf7f0] p-3 text-xs font-medium text-brand-pine"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-clay" /> Submission mode is <b className="mx-1">Manual only</b> — broad auto-submit is disabled in the MVP.</div>
          <p className="text-xs leading-relaxed text-zinc-500">Hunter injects 30–180s human-like delays between assisted actions and only acts inside the safe apply window (9am–8pm IST), enforced by <span className="font-mono">SafeApplyManager</span>. Edit the apply window, daily limit, and score threshold in <b>Settings → Apply Safety</b>.</p>
        </Card>
      )}

      {tab === "RESUME" && (
        <Card className="max-w-2xl space-y-4 rounded-2xl p-6">
          <div className="flex items-center justify-between">
            <div><h3 className="text-sm font-extrabold text-zinc-950">Active resume</h3><p className="text-xs text-zinc-500">The resume Hunter uses to score and tailor jobs.</p></div>
            <span className="rounded-full border border-brand-border bg-brand-chalk px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-brand-pine">Parsed ✓</span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500">Upload or replace your resume in <b>Settings → Resume</b>.</p>
        </Card>
      )}

      {tab === "ACCOUNT" && (
        <Card className="max-w-2xl space-y-4 rounded-2xl p-6 text-xs">
          <h3 className="text-sm font-extrabold text-zinc-950">Account & session</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 p-3"><span className="block font-mono text-[9px] uppercase text-zinc-400">Signed in as</span><b>{currentUserName() || "Hunter workspace"}</b><p className="font-mono text-[10px] text-zinc-500">{currentUserEmail() || "Local session"}</p></div>
            <div className="rounded-xl border border-zinc-200/60 bg-zinc-50 p-3"><span className="block font-mono text-[9px] uppercase text-zinc-400">Secrets</span><b>Encrypted server-side</b><p className="text-[10px] text-zinc-500">Never exposed in API responses</p></div>
          </div>
          <p className="flex items-center gap-1.5 text-[10px] leading-relaxed text-zinc-400"><ShieldCheck className="h-4 w-4 shrink-0 text-brand-clay" /> Passwords and tokens are managed server-side and never returned to the browser.</p>
        </Card>
      )}
    </div>
  );
}
