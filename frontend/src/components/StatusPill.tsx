interface StatusPillProps {
  label: string;
  tone?: "neutral" | "success" | "warning" | "error" | "accent";
}

const toneColor = {
  neutral: "var(--text-muted)",
  success: "var(--state-success)",
  warning: "var(--state-warning)",
  error: "var(--state-error)",
  accent: "var(--accent-clay)",
};

export function StatusPill({ label, tone = "neutral" }: StatusPillProps) {
  const color = toneColor[tone];
  const displayLabel = friendlyLabel(label);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{
        borderColor: `color-mix(in srgb, ${color} 46%, var(--border-default))`,
        color,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {displayLabel}
    </span>
  );
}

function friendlyLabel(label: string): string {
  const mapped: Record<string, string> = {
    external_pending: "Awaiting confirmation",
    needs_review: "Needs review",
    resume_and_preferences: "Resume + profile",
  };
  if (mapped[label]) return mapped[label];
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
