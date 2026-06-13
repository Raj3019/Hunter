import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ChevronDown,
  Check,
  ClipboardCheck,
  Cpu,
  FileText,
  Globe,
  Link2,
  Layers,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  Sparkles,
  Target,
  UploadCloud,
  UserPlus,
  Zap,
} from "lucide-react";
import { FlippingLogoBadge } from "../components/ui/PlatformLogos";
import { Spinner } from "../components/ui/spinner";

const LIVE_DEMO_JOBS = [
  {
    company: "Razorpay",
    title: "Software Engineer II (Frontend)",
    location: "Bangalore, KA",
    salary: "₹18L - ₹24L PA",
    required: ["React", "TypeScript", "Tailwind CSS", "GraphQL"],
    metrics: {
      score: 94,
      overlap: "Direct SDE-1 to SDE-2 promotion mapping",
      merits: ["React + TS overlap confirmed", "Meets ₹12L preference"],
      demerits: ["GraphQL missing"],
    },
  },
  {
    company: "GRID Labs",
    title: "Full Stack Engineer (Growth)",
    location: "Remote, India",
    salary: "₹15L - ₹22L PA",
    required: ["React", "Node.js", "PostgreSQL", "Tailwind CSS"],
    metrics: {
      score: 88,
      overlap: "Matches remote work preferences",
      merits: ["Node + Postgres stack aligned"],
      demerits: ["No explicit Redis listed"],
    },
  },
  {
    company: "Swiggy Tech",
    title: "Platform Systems Associate",
    location: "Mumbai Office",
    salary: "₹14L - ₹18L PA",
    required: ["Java", "Docker", "SQL", "Spring Boot"],
    metrics: {
      score: 45,
      overlap: "Substantial stack gap spotted",
      merits: ["Location overlaps options"],
      demerits: ["Stack mismatch (Java and Spring required)", "Avoid list alert: consultancies"],
    },
  },
];

type FaqItem = {
  q: string;
  a: string;
  supported?: string[];
  manual?: string[];
};

const FAQ_ITEMS: FaqItem[] = [
  {
    q: "How does Hunter's Match Index calculation work?",
    a: "Hunter parses direct skill overlap keywords, location restrictions, and salary preferences against your uploaded CV text in real-time. It calculates coefficient overlaps dynamically with direct, unbiased semantic rules.",
  },
  {
    q: "Is my CV data passed to training corpuses or external servers?",
    a: "No. Hunter uses secure local persistence and direct server-side APIs that protect candidate details. Your credentials and PDF contents are never retained on external analytical platforms.",
  },
  {
    q: "Can I connect premium credentials from Naukri or Foundit?",
    a: "Yes. Hunter acts as a local orchestrator. You can connect portal sessions, set scraped configurations, or upload PDF files directly in your own workspace environment.",
  },
  {
    q: "Which portals can Hunter auto-detect applications from?",
    a: "Hunter auto-detects applied status only where the connected portal exposes a readable history or applications page. Everything else stays as portal pending until you confirm it.",
    supported: ["Naukri", "Foundit", "Wipro", "HCLTech", "Infosys", "Capgemini"],
    manual: ["Internshala", "LinkedIn", "Generic company sites", "Workday / Taleo / custom portals", "Unknown external apply links"],
  },
  {
    q: "Is Hunter free to use?",
    a: "Yes. Hunter runs against your own portals and resume with no paywalls or subscription limits. You confirm every apply.",
  },
  {
    q: "How is 'Avoid List' muting handled?",
    a: "Add specific tags, consultancy names, or outsource agencies to your blocklist in Settings. Hunter automatically hides matched cards so you focus on premium openings.",
  },
];

const HOW_TO_USE_STEPS = [
  {
    icon: UserPlus,
    step: "01",
    label: "Account",
    title: "Create profile",
    body: "Sign up and open your private Hunter workspace.",
    iconClass: "bg-zinc-950 text-white",
  },
  {
    icon: UploadCloud,
    step: "02",
    label: "Resume",
    title: "Upload resume",
    body: "Upload your PDF so Hunter can read skills and experience.",
    iconClass: "bg-brand-clay text-white",
  },
  {
    icon: Link2,
    step: "03",
    label: "Portals",
    title: "Connect portals",
    body: "Connect Naukri, Foundit, or supported company career portals.",
    iconClass: "bg-sky-500 text-white",
  },
  {
    icon: SlidersHorizontal,
    step: "04",
    label: "Rules",
    title: "Set job rules",
    body: "Choose target roles, locations, salary range, and avoid-list terms.",
    iconClass: "bg-brand-ochre text-zinc-950",
  },
  {
    icon: SearchCheck,
    step: "05",
    label: "Matches",
    title: "Review matches",
    body: "Review scored jobs with matched and missing skills.",
    iconClass: "bg-brand-pine text-white",
  },
  {
    icon: ClipboardCheck,
    step: "06",
    label: "Tracker",
    title: "Apply and track",
    body: "Open the original portal, apply, then sync or confirm in Tracker.",
    iconClass: "bg-emerald-500 text-white",
  },
];

type CustomResult = { score: number; matched: string[]; missing: string[] };

export function Home() {
  const navigate = useNavigate();
  const [selectedJobIndex, setSelectedJobIndex] = useState(0);
  const [customJobText, setCustomJobText] = useState("");
  const [customMatchResult, setCustomMatchResult] = useState<CustomResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  if (localStorage.getItem("access_token")) {
    return <Navigate to="/dashboard" replace />;
  }

  const goAuth = () => navigate("/auth");
  const goSignIn = () => navigate("/auth", { state: { mode: "login" } });
  const goRegister = () => navigate("/auth", { state: { mode: "register" } });
  const activeJob = LIVE_DEMO_JOBS[selectedJobIndex];

  const handleSimulateCustomJob = () => {
    if (!customJobText.trim()) return;
    setIsSimulating(true);
    setCustomMatchResult(null);
    window.setTimeout(() => {
      const lowerText = customJobText.toLowerCase();
      const matched: string[] = [];
      const missing: string[] = [];
      let score = 50;
      const candidates = [
        { name: "React", w: 15 },
        { name: "TypeScript", w: 15 },
        { name: "Node.js", w: 12 },
        { name: "PostgreSQL", w: 10 },
        { name: "Tailwind CSS", w: 8 },
        { name: "Next.js", w: 10 },
        { name: "MongoDB", w: 8 },
      ];
      candidates.forEach((c) => {
        if (lowerText.includes(c.name.toLowerCase())) {
          matched.push(c.name);
          score += c.w;
        } else {
          missing.push(c.name);
        }
      });
      score = Math.max(40, Math.min(98, score));
      setCustomMatchResult({ score, matched, missing: missing.slice(0, 3) });
      setIsSimulating(false);
    }, 1200);
  };

  const fitScore = customMatchResult ? customMatchResult.score : activeJob.metrics.score;

  return (
    <div className="min-h-screen overflow-x-hidden bg-brand-linen bg-dot-grid font-sans text-[#09090b] selection:bg-zinc-900 selection:text-white">
      {/* Animated aurora mesh backdrop */}
      <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-[820px] w-full max-w-[1440px] -translate-x-1/2 overflow-hidden opacity-80">
        <div className="blob-a absolute -top-[180px] left-[5%] h-[550px] w-[550px] rounded-full bg-brand-ochre/25 blur-[140px]" />
        <div className="blob-b absolute -top-[140px] right-[10%] h-[480px] w-[480px] rounded-full bg-brand-clay/20 blur-[120px]" />
        <div className="blob-c absolute left-[35%] top-[220px] h-[320px] w-[320px] rounded-full bg-brand-pine/10 blur-[110px]" />
        <div className="blob-a absolute right-[26%] top-[140px] h-[320px] w-[320px] rounded-full bg-brand-clay/15 blur-[120px]" />
        <div className="blob-b absolute left-1/2 top-[440px] h-[460px] w-[680px] -translate-x-1/2 rounded-full bg-brand-clay/12 blur-[150px]" />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-[520px] w-[900px] -translate-x-1/2" style={{ background: "radial-gradient(ellipse at center top, rgba(255,255,255,0.65), transparent 70%)" }} />

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-brand-border/40 bg-brand-linen/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-pine text-white shadow-md">
              <Target className="h-4 w-4 stroke-[2.5] text-white" />
            </div>
            <div className="text-left">
              <span className="block font-display text-sm font-extrabold tracking-tight text-zinc-950">Hunter.sh</span>
              <span className="-mt-1 block font-mono text-[9px] font-bold uppercase tracking-tight text-zinc-400">SDE portals aggregator</span>
            </div>
            <span className="rounded border border-brand-border/40 bg-brand-chalk px-1.5 py-0.5 font-mono text-[9px] font-extrabold text-brand-pine">V3 ACTIVE</span>
          </div>

          <nav className="hidden items-center gap-6 font-sans text-xs font-bold text-zinc-500 md:flex">
            <a href="#demo" className="transition-colors hover:text-zinc-950">Scoring Sandbox</a>
            <a href="#pipeline" className="transition-colors hover:text-zinc-950">Capabilities</a>
            <a href="#how-to-use" className="transition-colors hover:text-zinc-950">How to use</a>
            <a href="#architecture" className="transition-colors hover:text-zinc-950">Safety</a>
            <a href="#faq" className="transition-colors hover:text-zinc-950">FAQ</a>
          </nav>

          <div className="flex items-center gap-2.5">
            <button type="button" onClick={goSignIn} className="rounded-xl px-3.5 py-2 text-xs font-bold text-zinc-650 transition-colors hover:bg-brand-chalk/50 hover:text-zinc-950">
              Sign In
            </button>
            <button type="button" onClick={goRegister} className="flex h-9 items-center gap-1.5 rounded-xl bg-brand-pine px-4 py-2 text-xs font-bold tracking-tight text-white shadow-sm transition-all hover:bg-brand-pine-deep">
              Get Started <ArrowRight className="h-3.5 w-3.5 text-white/90" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero */}
        <section className="mx-auto max-w-7xl space-y-12 px-6 pb-20 pt-16 text-center md:pb-28 md:pt-24">
          <div className="mx-auto max-w-4xl space-y-6">
            <div className="inline-flex animate-fade-in-slide items-center gap-2 rounded-full border border-brand-border bg-white px-3.5 py-1.5 text-[11px] font-semibold shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-brand-clay" />
              <span className="font-sans font-medium text-zinc-700">Bespoke resume aggregation for elite developers</span>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-clay" />
            </div>

            <h1 className="mx-auto max-w-5xl text-center font-display text-3xl font-black leading-[1.2] tracking-tight text-zinc-950 sm:text-5xl md:text-6xl lg:text-[4.5rem]">
              Target hyper-aligned roles on
              <FlippingLogoBadge interval={1000} />
              <br className="hidden sm:block" />
              and <span className="text-gradient-anim font-display">bypass standard portal noise.</span>
            </h1>

            <p className="mx-auto max-w-xl text-sm leading-relaxed text-zinc-500 sm:text-base">
              Stop blasting hundreds of empty applications. Hunter continuously sweeps active Indian feeds — Naukri, Foundit, Internshala, and custom URLs — measuring exact keyword match coefficients with zero effort.
            </p>

            <div className="mx-auto flex max-w-md flex-col justify-center gap-3 pt-3 sm:flex-row">
              <button type="button" onClick={goRegister} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-pine px-6 text-xs font-bold text-white shadow-md transition-all hover:scale-[1.01] active:scale-[0.99]">
                Access Free Account <Sparkle className="h-3.5 w-3.5 text-white/90" />
              </button>
              <button type="button" onClick={goAuth} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-linen px-6 text-xs font-bold text-zinc-800 shadow-sm transition-all hover:bg-brand-chalk">
                Inspect Sandbox
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-5 pt-5 font-mono text-[10px] text-zinc-400">
              <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-brand-clay" /> Secure sync profiles</span>
              <span>•</span>
              <span className="flex items-center gap-1"><Cpu className="h-3.5 w-3.5 text-zinc-500" /> AI ingest engine</span>
              <span>•</span>
              <span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5 text-zinc-500" /> Unified feed integrations</span>
            </div>
          </div>

          {/* Scoring sandbox */}
          <div id="demo" className="grid items-stretch gap-8 pt-8 text-left lg:grid-cols-12">
            {/* Selector column */}
            <div className="flex flex-col justify-between space-y-6 rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-md sm:p-8 lg:col-span-4">
              <div className="space-y-2">
                <span className="rounded border border-brand-border bg-brand-chalk px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-brand-clay">SANDBOX SIMULATION</span>
                <h3 className="font-display text-base font-extrabold text-zinc-900">Compare resume score alignments</h3>
                <p className="text-xs font-medium leading-relaxed text-zinc-500">
                  Select a live posting feed below to simulate Hunter's alignment scoring against a standard full-stack React CV.
                </p>
              </div>

              <div className="space-y-2.5">
                {LIVE_DEMO_JOBS.map((job, idx) => {
                  const active = selectedJobIndex === idx && !customMatchResult;
                  return (
                    <button
                      key={job.company}
                      type="button"
                      onClick={() => { setSelectedJobIndex(idx); setCustomMatchResult(null); }}
                      className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                        active ? "border-zinc-950 bg-zinc-950 text-white shadow" : "border-brand-border bg-brand-chalk/40 text-zinc-800 hover:bg-brand-chalk"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="block truncate text-[11px] font-extrabold">{job.company}</span>
                          <span className={`rounded-md px-1.5 text-[8px] font-bold ${active ? "bg-zinc-800 text-brand-clay" : "bg-zinc-200 text-zinc-650"}`}>{job.location}</span>
                        </div>
                        <span className={`mt-0.5 block truncate text-[10px] font-medium ${active ? "text-zinc-300" : "text-zinc-500"}`}>{job.title}</span>
                      </div>
                      <div className={`shrink-0 rounded-xl px-2 py-1 font-mono text-xs font-bold ${active ? "bg-brand-clay text-white" : "border border-brand-border bg-zinc-100 text-zinc-800"}`}>
                        {job.metrics.score}%
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3.5 border-t border-brand-border pt-5">
                <span className="block font-mono text-[9px] font-extrabold uppercase tracking-wider text-zinc-400">Run arbitrary test search</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Paste skills (e.g. Next.js, Redis, Java)"
                    value={customJobText}
                    onChange={(e) => setCustomJobText(e.target.value)}
                    className="h-10 flex-1 rounded-xl border border-brand-border bg-brand-chalk/40 px-3 text-xs font-medium focus:border-zinc-950 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSimulateCustomJob}
                    disabled={isSimulating}
                    className="flex h-10 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 text-xs font-bold text-white transition-all hover:bg-zinc-950"
                  >
                    {isSimulating ? <Spinner className="size-4" /> : "Test"}
                  </button>
                </div>
              </div>
            </div>

            {/* Output screen */}
            <div className="flex flex-col justify-between overflow-hidden rounded-3xl border border-brand-border bg-brand-linen shadow-md lg:col-span-8">
              <div className="border-b border-zinc-150 bg-brand-chalk/40 p-6 sm:p-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-950 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-white">INGEST_MODULE_ACTIVE</span>
                      <span className="font-mono text-[10px] text-zinc-400">2026 Sandbox Trace</span>
                    </div>
                    <h4 className="text-base font-extrabold text-zinc-950">{customMatchResult ? "Custom Test Workspace" : activeJob.company}</h4>
                    <p className="text-xs font-semibold text-zinc-500">{customMatchResult ? "Custom analyzed attributes" : `${activeJob.title} • ${activeJob.salary}`}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-brand-border bg-brand-linen p-2 px-3 shadow-sm">
                    <div className="text-right">
                      <span className="block font-mono text-[7px] font-bold uppercase tracking-wider text-zinc-400">FIT INDEX</span>
                      <span className="font-mono text-lg font-black text-zinc-950">{fitScore}%</span>
                    </div>
                    <div className={`rounded-lg border p-1.5 ${fitScore >= 80 ? "border-brand-border bg-brand-chalk text-brand-pine" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
                      <Sparkles className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-6 p-6 sm:p-8">
                <div className="space-y-2 rounded-2xl border border-brand-border/60 bg-brand-chalk/40 p-4 text-xs">
                  <span className="block font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-400">AI match assessment:</span>
                  <p className="font-medium leading-relaxed text-zinc-700">
                    {customMatchResult ? `Discovered ${customMatchResult.matched.length} core keywords in criteria. High overlap mapping computed.` : activeJob.metrics.overlap}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 text-xs">
                    <span className="block font-mono text-[9px] font-bold uppercase tracking-widest text-brand-pine">Matched core skills</span>
                    <div className="flex flex-wrap gap-1.5">
                      {customMatchResult ? (
                        customMatchResult.matched.length > 0 ? (
                          customMatchResult.matched.map((skill) => (
                            <span key={skill} className="rounded border border-brand-border bg-brand-chalk px-2 py-0.5 font-mono text-[10px] font-bold text-brand-pine">✓ {skill}</span>
                          ))
                        ) : <span className="text-[11px] font-medium text-zinc-400">No skill overlaps spotted</span>
                      ) : (
                        activeJob.required.map((skill) => (
                          <span key={skill} className="rounded border border-brand-border bg-brand-chalk px-2 py-0.5 font-mono text-[10px] font-bold text-brand-pine">✓ {skill}</span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <span className="block font-mono text-[9px] font-bold uppercase tracking-widest text-brand-clay">Missing stack targets</span>
                    <div className="flex flex-wrap gap-1.5">
                      {customMatchResult ? (
                        customMatchResult.missing.length > 0 ? (
                          customMatchResult.missing.map((skill) => (
                            <span key={skill} className="rounded border border-rose-100 bg-rose-500/5 px-2 py-0.5 font-mono text-[10px] text-rose-800">• {skill}</span>
                          ))
                        ) : <span className="text-[11px] font-medium text-brand-pine">100% full match</span>
                      ) : (
                        activeJob.metrics.demerits.map((demerit) => (
                          <span key={demerit} className="block w-full rounded border border-brand-border bg-[#fcfbf8] px-2 py-1.5 font-sans text-[10px] font-bold leading-tight text-zinc-650">{demerit}</span>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {!customMatchResult && (
                  <div className="pt-2">
                    <span className="mb-2 block font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-400">Verified merits</span>
                    <div className="space-y-1.5 text-xs text-zinc-650">
                      {activeJob.metrics.merits.map((merit) => (
                        <p key={merit} className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" />
                          <span className="font-medium">{merit}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-zinc-150 bg-brand-chalk/40 p-6">
                <span className="font-mono text-[10px] font-semibold text-zinc-400">Ready to deploy real resumes?</span>
                <button type="button" onClick={goRegister} className="flex items-center gap-1 rounded-xl bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-zinc-900">
                  Start Scanning Portals <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Bento capabilities */}
        <section id="pipeline" className="mx-auto max-w-7xl border-t border-brand-border/60 px-6 py-20 font-sans">
          <div className="mx-auto mb-14 max-w-xl space-y-3.5 text-center">
            <span className="rounded border border-brand-border bg-brand-chalk/50 px-2 py-0.5 font-mono text-[9px] font-bold text-zinc-800">MODERN CAPABILITIES</span>
            <h2 className="font-display text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Everything Hunter does for you</h2>
            <p className="text-xs font-semibold leading-relaxed text-zinc-500">Visual metrics, diagnostic indicators, and resume synchronizers. No backend fluff.</p>
          </div>

          <div className="grid items-stretch gap-6 md:grid-cols-12">
            <div className="flex flex-col justify-between space-y-8 rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-sm sm:p-8 md:col-span-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white"><Layers className="h-5 w-5 text-brand-clay" /></div>
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-zinc-950">Intelligent scraper sweeper</h3>
                <p className="text-[11px] font-medium leading-relaxed text-zinc-500">Connect live profile configurations, set salary and experience rules, and watch seamless index updates with zero friction.</p>
              </div>
              <div className="space-y-1 rounded-2xl border border-dashed border-brand-border bg-brand-chalk/40 p-3.5 font-mono text-[10px]">
                <p className="text-zinc-400">• status_endpoints: OK</p>
                <p className="text-zinc-400">• crawl_frequency: v3_instant</p>
                <p className="font-extrabold text-brand-pine">• synced_job_shortlists: 94% match</p>
              </div>
            </div>

            <div className="flex flex-col justify-between space-y-6 rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-sm sm:p-8 md:col-span-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1">
                  <span className="rounded bg-brand-chalk px-2 font-mono text-[9px] font-bold text-brand-pine">RESUME_EMBEDDINGS</span>
                  <h3 className="mt-1 text-base font-extrabold text-zinc-900">Side-by-side CV alignment</h3>
                </div>
                <div className="flex gap-1.5 rounded-lg border border-brand-border bg-brand-chalk/40 p-1 font-mono text-[10px] font-bold">
                  <span className="rounded bg-brand-clay px-2 py-0.5 text-white">PDF</span>
                  <span className="px-1 py-0.5 text-zinc-500">Ingested</span>
                </div>
              </div>
              <p className="max-w-xl text-xs font-medium leading-relaxed text-zinc-500">Our parser structures your resume against search queries — mapping experience, highlighting salary guidelines, and structuring tailored resume drafts dynamically.</p>
              <div className="grid gap-3.5 pt-2 font-mono text-[10px] text-zinc-500 sm:grid-cols-3">
                <div className="rounded-xl border border-brand-border bg-brand-chalk/40 p-3">
                  <span className="block font-bold tracking-wide text-zinc-400">MATCH COEFFICIENT</span>
                  <span className="mt-0.5 block text-sm font-bold text-brand-pine">94% overlap</span>
                </div>
                <div className="rounded-xl border border-brand-border bg-brand-chalk/40 p-3">
                  <span className="block font-bold tracking-wide text-zinc-400">AVOID LIST MUTED</span>
                  <span className="mt-0.5 block font-bold text-zinc-950">3 outsource units</span>
                </div>
                <div className="rounded-xl border border-brand-border bg-brand-chalk/40 p-3">
                  <span className="block font-bold tracking-wide text-zinc-400">SYNC STATS</span>
                  <span className="mt-0.5 block font-bold text-brand-pine">Real-time logs</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between space-y-6 rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-sm sm:p-8 md:col-span-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white"><FileText className="h-5 w-5 text-brand-clay" /></div>
              <div className="space-y-2">
                <h3 className="text-sm font-extrabold text-zinc-950">Adaptive PDF resume tailoring</h3>
                <p className="text-xs font-medium leading-relaxed text-zinc-500">We generate tailored summaries and priority-skill matrices without modifying historic titles, dates, or inventing positions. Full compliance guaranteed.</p>
              </div>
            </div>

            <div className="flex flex-col justify-between space-y-5 rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-sm sm:p-8 md:col-span-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-950 text-white"><Zap className="h-5 w-5 text-amber-500" /></div>
              <div className="space-y-1.5">
                <h3 className="text-xs font-extrabold text-zinc-950 sm:text-sm">Portal confirmation tracking</h3>
                <p className="text-[11px] font-medium leading-relaxed text-zinc-500">Track resume versions, log application timelines, and keep tabs on recruiter callbacks securely.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Short usage flow */}
        <section id="how-to-use" className="mx-auto max-w-7xl border-t border-brand-border/60 px-6 py-20 font-sans">
          <div className="mx-auto mb-12 max-w-2xl space-y-3 text-center">
            <span className="rounded border border-brand-border bg-brand-chalk/50 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-brand-pine">Main user flow</span>
            <h2 className="font-display text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">How a user gets from setup to tracked applications</h2>
            <p className="text-xs font-semibold leading-relaxed text-zinc-500">The important steps only: profile, resume, portals, rules, matches, and tracker.</p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {HOW_TO_USE_STEPS.map((step) => {
              const Icon = step.icon;
              return (
                <article key={step.step} className="group relative overflow-hidden rounded-3xl border border-brand-border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-lg">
                  <span className="pointer-events-none absolute -right-2 -top-5 font-display text-[60px] font-black leading-none text-zinc-100 transition-colors group-hover:text-brand-chalk">{step.step}</span>
                  <div className="relative z-10">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="rounded-full border border-brand-border bg-brand-linen px-2 py-1 font-mono text-[9px] font-black uppercase tracking-wider text-zinc-500">{step.label}</span>
                        <h3 className="mt-3 font-display text-lg font-black tracking-tight text-zinc-950">{step.title}</h3>
                      </div>
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl shadow-sm ${step.iconClass}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    <p className="mt-3 max-w-[18rem] text-xs font-semibold leading-relaxed text-zinc-500">{step.body}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mx-auto mt-8 flex max-w-5xl flex-wrap items-center justify-center gap-2 rounded-2xl border border-brand-border bg-brand-chalk/40 px-4 py-3 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <span>Create profile</span>
            <ArrowRight className="h-3 w-3 text-brand-clay" />
            <span>Upload resume</span>
            <ArrowRight className="h-3 w-3 text-brand-clay" />
            <span>Connect portals</span>
            <ArrowRight className="h-3 w-3 text-brand-clay" />
            <span>Set rules</span>
            <ArrowRight className="h-3 w-3 text-brand-clay" />
            <span>Review matches</span>
            <ArrowRight className="h-3 w-3 text-brand-clay" />
            <span>Track applications</span>
          </div>
        </section>

        {/* How it works */}
        <section id="architecture" className="border-y border-brand-border/60 bg-brand-linen px-6 py-20 font-sans">
          <div className="mx-auto max-w-4xl space-y-12">
            <div className="mx-auto max-w-xl space-y-3 text-center">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-pine">YOU STAY IN CONTROL</span>
              <h2 className="font-display text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Built for serious job seekers</h2>
              <p className="text-xs font-semibold text-zinc-500">No auto-submit, no spam. Hunter curates and tracks — you confirm every application.</p>
            </div>

            <div className="mx-auto grid max-w-3xl gap-8 md:grid-cols-2">
              <div className="relative flex flex-col justify-between space-y-6 overflow-hidden rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-sm sm:p-8">
                <div className="space-y-4">
                  <div>
                    <span className="rounded border border-brand-border bg-zinc-150 px-2 py-0.5 font-mono text-[9px] font-bold text-zinc-700">ASSIST-ONLY</span>
                    <h3 className="mt-2 text-sm font-extrabold text-zinc-900">You apply, never a bot</h3>
                    <p className="text-[11px] font-medium text-zinc-400">No automated submissions, ever</p>
                  </div>
                  <p className="text-xs font-medium leading-relaxed text-zinc-500">Hunter scores each role against your resume and opens the original portal listing for you to submit. Nothing is auto-applied — so there's no ToS breach or account-ban risk.</p>
                  <hr className="border-brand-border" />
                  <ul className="space-y-2.5 text-[11.5px] font-medium text-zinc-650">
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" /> You review and submit every application</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" /> Opens the real portal in your own session</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" /> Every application tracked end-to-end</li>
                  </ul>
                </div>
                <div className="inline-block w-full rounded-xl border border-zinc-150 bg-brand-chalk/40 p-2.5 text-center font-mono text-[10px] text-zinc-400">mode: <b>ASSIST_ONLY</b></div>
              </div>

              <div className="relative flex flex-col justify-between space-y-6 overflow-hidden rounded-3xl border border-brand-border bg-brand-linen p-6 shadow-sm sm:p-8">
                <div className="space-y-4">
                  <div>
                    <span className="rounded bg-zinc-950 px-2 py-0.5 font-mono text-[9px] font-bold text-white">ENCRYPTED CREDENTIALS</span>
                    <h3 className="mt-2 text-sm font-extrabold text-zinc-900">Your portal logins stay protected</h3>
                    <p className="text-[11px] font-medium text-zinc-400">Encrypted on connect, never exposed</p>
                  </div>
                  <p className="text-xs font-medium leading-relaxed text-zinc-500">Portal passwords are encrypted the moment you connect and decrypted only at the instant of sign-in — never logged, never returned by the API, never shared with third parties.</p>
                  <hr className="border-brand-border" />
                  <ul className="space-y-2.5 text-[11.5px] font-medium text-zinc-650">
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" /> Fernet-encrypted credential storage</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" /> Passwords never returned by the API</li>
                    <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 shrink-0 text-brand-clay" /> No tracking scripts or ads</li>
                  </ul>
                </div>
                <button type="button" onClick={goRegister} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-pine text-xs font-bold text-white shadow-md transition-all hover:scale-[1.01] hover:bg-brand-pine-deep active:scale-[0.99]">
                  Get started free <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-4xl border-t border-brand-border/60 px-6 py-20 text-left font-sans">
          <div className="mx-auto mb-14 max-w-xl space-y-3.5 text-center">
            <span className="inline-block rounded border border-brand-border bg-brand-chalk px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-brand-pine">Common inquiries</span>
            <h2 className="font-display text-2xl font-black tracking-tight text-zinc-950 sm:text-3xl">Frequently asked questions</h2>
            <p className="text-xs font-semibold leading-relaxed text-zinc-500">Transparent specifications. No gatekeeping, no premium paywalls.</p>
          </div>

          <div className="space-y-3.5">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={item.q} className="overflow-hidden rounded-2xl border border-brand-border bg-brand-linen shadow-sm transition-all">
                  <button type="button" onClick={() => setOpenFaqIndex(isOpen ? null : idx)} className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-brand-chalk/45">
                    <span className="font-sans text-xs font-extrabold tracking-tight text-zinc-950 sm:text-[13px]">{item.q}</span>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ${isOpen ? "border-zinc-950 bg-zinc-950 text-white shadow-sm" : "border-brand-border bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-950"}`}>
                      <ChevronDown className={`h-4 w-4 stroke-[2.5] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: "easeInOut" }} className="overflow-hidden border-t border-brand-border">
                        <div className="bg-[#FAFAF9] p-6 font-sans text-xs font-medium leading-relaxed text-zinc-500">
                          <p>{item.a}</p>
                          {(item.supported || item.manual) && (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                              {item.supported && (
                                <FaqPortalList title="Auto-detect supported" tone="success" items={item.supported} />
                              )}
                              {item.manual && (
                                <FaqPortalList title="Manual confirmation" tone="manual" items={item.manual} />
                              )}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="border-t border-brand-border/60 bg-brand-linen px-6 py-12">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 text-left sm:flex-row">
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-950 text-white shadow-sm"><Target className="h-3.5 w-3.5 text-brand-ochre" /></div>
            <div>
              <span className="block text-xs font-extrabold text-zinc-900">Hunter</span>
              <span className="-mt-1 block font-mono text-[9px] font-bold text-zinc-400">© 2026 Job automation suite</span>
            </div>
          </div>
          <div className="flex gap-5 font-bold uppercase tracking-wider text-zinc-400" style={{ fontSize: "10px" }}>
            <span>Private by default</span>
            <span>You confirm every apply</span>
            <span>Made in India 🇮🇳</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FaqPortalList({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "success" | "manual";
  items: string[];
}) {
  const dotClass = tone === "success" ? "bg-emerald-500" : "bg-amber-500";
  const shellClass = tone === "success" ? "border-emerald-100 bg-emerald-50/70" : "border-amber-100 bg-amber-50/70";

  return (
    <div className={`rounded-2xl border p-3.5 ${shellClass}`}>
      <div className="mb-2 flex items-center gap-2 font-mono text-[9px] font-black uppercase tracking-wider text-zinc-500">
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
        {title}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((portal) => (
          <span key={portal} className="rounded-lg border border-white/80 bg-white px-2 py-1 font-mono text-[10px] font-bold text-zinc-700 shadow-sm">
            {portal}
          </span>
        ))}
      </div>
    </div>
  );
}
