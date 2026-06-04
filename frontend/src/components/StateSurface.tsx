import type { LucideIcon } from "lucide-react";

interface StateSurfaceProps {
  icon: LucideIcon;
  title: string;
  body: string;
  primary?: string;
  secondary?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}

export function StateSurface({ icon: Icon, title, body, primary, secondary, onPrimary, onSecondary }: StateSurfaceProps) {
  return (
    <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-6">
      <Icon size={22} className="mb-3 text-[var(--accent-primary)]" />
      <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
      <p className="mt-1 max-w-xl text-sm text-[var(--text-muted)]">{body}</p>
      {(primary || secondary) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {primary && (
            <button
              type="button"
              onClick={onPrimary}
              className="rounded-md bg-[var(--accent-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
            >
              {primary}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              onClick={onSecondary}
              className="rounded-md border border-[var(--border-default)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:border-[var(--accent-primary)]"
            >
              {secondary}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
