import { useNavigate } from "react-router-dom";
import { ArrowLeft, Target } from "lucide-react";

const LAST_UPDATED = "14 June 2026";

export function Terms() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-brand-linen font-sans text-zinc-800">
      {/* Header */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-brand-border bg-white px-4 sm:px-6">
        <button type="button" onClick={() => navigate("/")} className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-zinc-950 text-white shadow-sm">
            <Target className="h-3.5 w-3.5 text-brand-clay" />
          </div>
          <span className="text-sm font-bold text-zinc-950">Hunter</span>
        </button>
        <button type="button" onClick={() => navigate("/")} className="flex items-center gap-1 text-xs font-semibold text-zinc-500 transition-colors hover:text-zinc-950">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </button>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-pine">Legal</span>
        <h1 className="mt-2 font-display text-3xl font-black tracking-tight text-zinc-950">Terms &amp; Conditions</h1>
        <p className="mt-2 text-xs font-semibold text-zinc-400">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-sm leading-relaxed text-zinc-600">
          <Section n="1" title="Acceptance of terms">
            By creating an account or using Hunter, you confirm that you have read, understood, and agree to
            these Terms &amp; Conditions. If you do not agree, please do not use the service.
          </Section>

          <Section n="2" title="What Hunter is">
            Hunter is an <b>assist-only</b> job-search tool. It searches public job listings, scores them against
            your resume, and opens the <b>original job portal</b> so you can review and submit each application
            yourself. <b>Hunter does not submit applications on your behalf</b> and does not guarantee any job,
            interview, or response. Hunter is an independent tool and is <b>not affiliated with, endorsed by, or
            partnered with</b> Naukri, Foundit, Internshala, or any company career portal.
          </Section>

          <Section n="3" title="Third-party portals and account actions">
            <p>
              You use third-party job portals through your own accounts and at your own risk. You are responsible
              for complying with the terms of service of every portal you use.
            </p>
            <p className="mt-3 font-bold text-zinc-900">
              Hunter is not responsible if your account on any job portal (including Naukri, Foundit, Internshala,
              or any company career site) is banned, blocked, suspended, restricted, flagged, or otherwise
              actioned. Any such action is taken solely by that third-party portal, and Hunter accepts no
              liability for it.
            </p>
            <p className="mt-3">
              You acknowledge that automated or unusual activity on third-party portals may, at those portals'
              discretion, lead to such actions, and that you use Hunter with this understanding.
            </p>
          </Section>

          <Section n="4" title="Your responsibilities">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>Provide accurate information and a resume you are authorised to use.</li>
              <li>Review, submit, and confirm every application yourself.</li>
              <li>Comply with the terms of service of each job portal you connect or use.</li>
              <li>Keep your login credentials secure and use only accounts that belong to you.</li>
            </ul>
          </Section>

          <Section n="5" title="Credentials and data">
            Any portal credentials you choose to save are <b>encrypted</b> and used only to assist your searches
            and applied-status tracking. You provide them at your own risk and can disconnect or delete them at
            any time. Hunter never displays your stored passwords and never returns them through its interface.
          </Section>

          <Section n="6" title="No warranty">
            The service is provided <b>"as is" and "as available", without warranties of any kind</b>. Hunter does
            not guarantee that listings are accurate, current, complete, or available, nor that the service will
            be uninterrupted or error-free.
          </Section>

          <Section n="7" title="Limitation of liability">
            To the maximum extent permitted by law, Hunter and its operators shall <b>not be liable</b> for any
            indirect, incidental, or consequential damages, lost opportunities, missed applications, or actions
            taken against your accounts by third-party portals arising from your use of the service.
          </Section>

          <Section n="8" title="Changes">
            We may update the service or these terms from time to time. Continued use after changes means you
            accept the updated terms.
          </Section>
        </div>
      </main>

      <footer className="border-t border-brand-border bg-white py-6 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Hunter • Assist-only job search
      </footer>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-extrabold text-zinc-950">{n}. {title}</h2>
      <div className="text-sm leading-relaxed text-zinc-600">{children}</div>
    </section>
  );
}
