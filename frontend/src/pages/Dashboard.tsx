import { Calendar, CheckCircle2, ChevronRight, Eye, RefreshCw, Send, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useNavigate } from "react-router-dom";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FakeDataTooltip } from "@/components/ui/fake-data-tooltip";
import { CompanyLogo } from "@/components/ui/company-logo";
import { FounditLogo, IndeedLogo, InternshalaLogo, LinkedInLogo, NaukriLogo } from "@/components/ui/PlatformLogos";
import type { Application, JobMatch } from "@/types";

interface DashboardProps {
  jobs: JobMatch[];
  applications: Application[];
  onApprove?: (id: string) => void;
  onSkip: (id: string) => void;
  onQueue: (id: string) => void;
  onRefresh: () => void | Promise<unknown>;
  applyingLocked?: boolean;
  recommendThreshold?: number;
}

const STAGES = [
  { key: "external_pending", label: "Awaiting", color: "var(--color-chart-amber)" },
  { key: "applied", label: "Applied", color: "var(--color-data-ink)" },
  { key: "viewed", label: "Viewed", color: "var(--color-chart-sky)" },
  { key: "interview", label: "Interview", color: "var(--accent-clay)" },
  { key: "offer", label: "Offer", color: "var(--color-chart-emerald)" },
  { key: "failed", label: "Failed", color: "var(--color-chart-gray)" },
] as const;

const LOGO_MAP: Record<string, (props: { className?: string }) => JSX.Element> = {
  naukri: NaukriLogo,
  foundit: FounditLogo,
  indeed: IndeedLogo,
  internshala: InternshalaLogo,
  linkedin: LinkedInLogo,
};

function PortalMark({ name, className = "" }: { name: string; className?: string }) {
  const Logo = LOGO_MAP[name?.toLowerCase()];
  if (Logo) {
    return (
      <span className={`inline-flex h-4 origin-left scale-[0.62] items-center ${className}`}>
        <Logo />
      </span>
    );
  }
  return <span className={`font-mono text-[11px] font-bold uppercase tracking-tight text-zinc-700 ${className}`}>{name}</span>;
}

export function Dashboard({ jobs, applications, onRefresh, recommendThreshold = 60 }: DashboardProps) {
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);

  const shortlistThreshold = Number(localStorage.getItem("hunter_shortlist_threshold")) || recommendThreshold;
  const totalMatches = jobs.filter((j) => j.score >= shortlistThreshold).length;
  const portalPending = applications.filter((a) => a.status === "external_pending").length;
  const totalApplied = applications.filter((a) => a.status === "applied").length;
  const averageMatchScore = Math.round(jobs.reduce((acc, job) => acc + job.score, 0) / (jobs.length || 1));

  const donutSegments = useMemo(
    () =>
      STAGES.map((s) => ({ label: s.label, color: s.color, value: applications.filter((a) => a.status === s.key).length })).filter((s) => s.value > 0),
    [applications]
  );
  const donutTotal = donutSegments.reduce((sum, s) => sum + s.value, 0);

  const portalBars = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach((j) => { counts[j.portal] = (counts[j.portal] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [jobs]);
  const portalMax = Math.max(1, ...portalBars.map((p) => p[1]));

  const topMatches = useMemo(() => [...jobs].sort((a, b) => b.score - a.score).slice(0, 3), [jobs]);

  const activity = useMemo(
    () =>
      applications
        .filter((a) => ["applied", "viewed", "interview", "offer", "external_pending"].includes(a.status))
        .slice(0, 5)
        .map((a) => ({
          text:
            a.status === "interview"
              ? `Interview scheduled — ${a.company}`
              : a.status === "offer"
                ? `Offer received — ${a.company}`
                : a.status === "viewed"
                  ? `Recruiter viewed — ${a.company}`
                  : `Applied — ${a.company}`,
          when: a.latestDate,
          status: a.status,
        })),
    [applications]
  );

  const runScan = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await onRefresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="animate-fade-in-slide space-y-6 text-left font-sans">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <Badge variant="secondary" className="gap-2 rounded-full font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-600">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-clay" /> Real-time sync active
          </Badge>
          <h1 className="font-display text-2xl font-black leading-tight tracking-tight text-zinc-900 md:text-3xl">Welcome back.</h1>
          <p className="text-xs font-medium text-zinc-500">Your resume is up to date — we're scanning portals for roles that fit you.</p>
        </div>
        <Button onClick={runScan} disabled={syncing} className="h-11 shrink-0 rounded-xl bg-brand-pine px-5 text-xs font-bold hover:bg-brand-pine-deep">
          {syncing ? <Spinner className="text-brand-clay" /> : <RefreshCw className="text-brand-clay" />} {syncing ? "Scanning portals…" : "Scan portals feed"}
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 md:gap-5">
        <StatCard label="Shortlists" value={totalMatches} sub={`≥ ${shortlistThreshold}% match`} delta={3} data={[4, 6, 5, 8, 7, 9, totalMatches]} color="var(--accent-clay)" />
        <StatCard label="Pending Applies" value={portalPending} sub="drafts" delta={1} data={[0, 1, 1, 2, 1, 2, portalPending]} color="var(--color-chart-amber)" />
        <StatCard label="Confirmed Applied" value={totalApplied} sub="logged" delta={2} data={[0, 0, 1, 1, 2, 2, totalApplied]} color="var(--color-data-ink)" />
        <StatCard label="Avg Match Score" value={`${averageMatchScore}%`} sub="fit" delta={6} data={[71, 74, 78, 80, 83, 85, averageMatchScore]} color="var(--accent-clay)" />
      </div>

      {/* Charts row */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="rounded-2xl">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-zinc-900">Pipeline by stage</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/tracker")} className="h-auto gap-0.5 p-0 text-[11px] font-bold text-zinc-500 hover:bg-transparent hover:text-zinc-900">
              Tracker <ChevronRight className="!size-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {donutSegments.length ? (
              <div className="flex items-center gap-5">
                <div className="relative h-[120px] w-[120px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutSegments} dataKey="value" nameKey="label" innerRadius={40} outerRadius={58} paddingAngle={2} stroke="none">
                        {donutSegments.map((s) => (
                          <Cell key={s.label} fill={s.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center font-display text-xl font-black text-zinc-900">{donutTotal}</div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {donutSegments.map((s) => (
                    <div key={s.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 text-zinc-500">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.label}
                      </span>
                      <span className="font-mono font-bold text-zinc-900">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-zinc-400">No applications yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-zinc-900">Matches by portal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {portalBars.length ? (
              portalBars.map(([portal, count]) => (
                <div key={portal} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <PortalMark name={portal} />
                    <span className="font-mono text-xs font-bold text-zinc-900">{count}</span>
                  </div>
                  <Progress value={(count / portalMax) * 100} className="h-2 bg-zinc-100" indicatorClassName="bg-zinc-900" />
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-xs text-zinc-400">No matches yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-zinc-900">Matches found</CardTitle>
            <span className="font-mono text-[10px] font-bold uppercase text-zinc-400">last 7 days</span>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-zinc-900">{jobs.length}</span>
              <Trend delta={12} suffix="%" />
            </div>
            <Spark data={[5, 8, 6, 9, 7, 11, jobs.length]} color="var(--accent-clay)" height={44} />
            <p className="text-[11px] font-medium text-zinc-500">Curated above 60% match across all connected feeds.</p>
          </CardContent>
        </Card>
      </div>

      {/* Top matches + recent activity */}
      <div className="grid gap-5 lg:grid-cols-12">
        <Card className="rounded-2xl lg:col-span-7">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-bold text-zinc-900">Top matches today</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")} className="h-auto gap-0.5 p-0 text-[11px] font-bold text-zinc-500 hover:bg-transparent hover:text-zinc-900">
              View all ({jobs.length}) <ChevronRight className="!size-3" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {topMatches.length ? (
              topMatches.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => navigate("/jobs")}
                  className="w-full space-y-2.5 rounded-xl border border-zinc-200 p-4 text-left transition-all hover:border-zinc-300 hover:bg-zinc-50/50"
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:grid-cols-[150px_minmax(0,1fr)_auto]">
                    <div className="flex h-8 min-w-0 items-center overflow-hidden rounded-md sm:w-[150px]">
                      <PortalMark name={job.portal} />
                    </div>
                    <div className="flex min-w-0 items-start gap-2 sm:pt-0.5">
                      <CompanyLogo company={job.company} logoUrl={job.companyLogoUrl} externalUrl={job.externalApplyUrl} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold leading-5 text-zinc-900">{job.company}</p>
                        <p className="truncate text-[11px] font-medium leading-4 text-zinc-500">{job.title}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={`shrink-0 rounded-lg font-mono text-[11px] font-extrabold ${job.score >= 85 ? "border-brand-border bg-brand-chalk text-brand-pine" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>
                      {job.score}%
                    </Badge>
                  </div>
                  <Progress value={job.score} className="h-2 bg-zinc-100" indicatorClassName={job.score >= 85 ? "bg-brand-clay" : "bg-zinc-400"} />
                </button>
              ))
            ) : (
              <p className="py-6 text-center text-xs text-zinc-400">No matches yet — run a search.</p>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-zinc-900">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.length ? (
              activity.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-100">
                    {a.status === "interview" ? (
                      <Calendar className="h-4 w-4 text-brand-clay" />
                    ) : a.status === "offer" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : a.status === "viewed" ? (
                      <Eye className="h-4 w-4 text-sky-600" />
                    ) : (
                      <Send className="h-4 w-4 text-zinc-600" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold leading-snug text-zinc-800">{a.text}</p>
                    <p className="font-mono text-[10px] text-zinc-400">{a.when}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-400">No recent activity.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, delta, data, color }: { label: string; value: ReactNode; sub: string; delta: number; data: number[]; color: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
          <Trend delta={delta} />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-3xl font-black tracking-tight text-zinc-900">{value}</span>
          <span className="font-mono text-[10px] font-semibold text-zinc-400">{sub}</span>
        </div>
        <Spark data={data} color={color} height={36} />
      </CardContent>
    </Card>
  );
}

function Trend({ delta, suffix = "" }: { delta: number; suffix?: string }) {
  const up = delta >= 0;
  return (
    <FakeDataTooltip label="Trend delta is an illustrative sample — not live yet">
      <span className="inline-flex cursor-help">
        <Badge variant="secondary" className={`gap-0.5 rounded-md px-1.5 py-0 font-mono text-[10px] font-bold ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {up ? <TrendingUp className="!size-3" /> : <TrendingDown className="!size-3" />}
          {Math.abs(delta)}
          {suffix}
        </Badge>
      </span>
    </FakeDataTooltip>
  );
}

function Spark({ data, color, height = 36 }: { data: number[]; color: string; height?: number }) {
  const chartData = (data.length ? data : [0, 0]).map((v, i) => ({ i, v }));
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <FakeDataTooltip label="Sparkline history is illustrative — only the latest value is live">
      <div className="w-full cursor-help" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${id})`} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </FakeDataTooltip>
  );
}
