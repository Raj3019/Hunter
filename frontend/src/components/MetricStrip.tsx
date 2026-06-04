interface MetricStripProps {
  metrics: Array<{ label: string; value: number | string; tone?: "success" | "warning" | "error" }>;
}

const toneMap = {
  success: "var(--state-success)",
  warning: "var(--state-warning)",
  error: "var(--state-error)",
};

export function MetricStrip({ metrics }: MetricStripProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric, index) => (
        <div key={metric.label} className="desk-panel relative overflow-hidden rounded-xl p-4">
          <div className="absolute right-3 top-3 text-xs text-[var(--text-muted)]">0{index + 1}</div>
          <p className="text-xs font-medium text-[var(--text-muted)]">{metric.label}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="text-3xl font-semibold leading-none tracking-tight" style={{ color: metric.tone ? toneMap[metric.tone] : "var(--text-primary)" }}>
              {metric.value}
            </p>
            <div className="h-2 w-20 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
              <div className="h-full rounded-full" style={{ width: "68%", background: metric.tone ? toneMap[metric.tone] : "var(--accent-primary)" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
