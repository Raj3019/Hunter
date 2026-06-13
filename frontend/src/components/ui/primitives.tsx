import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";

// ============================================================================
// Shared design-system primitives for the Hunter v3 look (zinc + terracotta).
// Pages compose these so the styling stays centralized.
// ============================================================================

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** White elevated card with the v0 border + hover treatment. */
export function BrandCard({
  children,
  className = "",
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx("v0-card rounded-2xl", className)} {...rest}>
      {children}
    </Tag>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { className?: string };

export function BrandButton({ className = "", children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        "v0-btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function BrandButtonSecondary({ className = "", children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        "v0-btn-secondary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Clay (terracotta) accent button for the single primary action. */
export function ClayButton({ className = "", children, ...rest }: BtnProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl bg-brand-clay px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-clay-deep disabled:cursor-not-allowed disabled:opacity-55",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Uppercase mono eyebrow label used across the design. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400", className)}>
      {children}
    </span>
  );
}

/** KPI metric tile with optional clay accent rail and sublabel. */
export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <BrandCard className={cx("relative overflow-hidden p-4 sm:p-5", className)}>
      {accent && <span className="absolute inset-y-0 left-0 w-1 bg-brand-clay" />}
      <div className="flex items-start justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        {icon && <span className="text-zinc-400">{icon}</span>}
      </div>
      <p className="mt-3 font-display text-2xl font-semibold tracking-tight text-brand-pine sm:text-3xl">{value}</p>
      {sub && <p className="mt-1 text-xs text-brand-sand">{sub}</p>}
    </BrandCard>
  );
}

function scoreColor(score: number) {
  if (score >= 85) return "var(--accent-clay)";
  if (score >= 60) return "var(--score-mid)";
  return "var(--color-chart-gray)";
}

/** Compact match-score badge. >=85 reads as clay (top match). */
export function ScorePill({ score, className = "" }: { score: number; className?: string }) {
  const pct = Math.round(score);
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono text-xs font-semibold",
        className
      )}
      style={{ color: scoreColor(pct), borderColor: "color-mix(in srgb, currentColor 35%, transparent)" }}
    >
      {pct}% match
    </span>
  );
}

/** Horizontal match meter with a filled bar. */
export function MatchMeter({ pct, showLabel = false, className = "" }: { pct: number; showLabel?: boolean; className?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={cx("w-full", className)}>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-brand-sand">
          <span>Match</span>
          <span style={{ color: scoreColor(value) }}>{value}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-brand-chalk">
        <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: scoreColor(value) }} />
      </div>
    </div>
  );
}

/** Horizontal bar row (e.g. matches-by-portal). */
export function BarRow({
  label,
  value,
  max,
  color = "var(--color-data-ink)",
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-xs text-brand-sand">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-brand-chalk">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 shrink-0 text-right font-mono text-xs text-brand-pine">{value}</span>
    </div>
  );
}

/** Scroll-reveal wrapper (adds .reveal-in when it enters the viewport). */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShown(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.12 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cx("reveal", shown && "reveal-in", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export type DonutSegment = { label: string; value: number; color: string };

/** SVG donut chart. Renders an empty ring when there is no data. */
export function Donut({ segments, size = 132, stroke = 16 }: { segments: DonutSegment[]; size?: number; stroke?: number }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />
      {total > 0 &&
        segments.map((seg) => {
          const len = (seg.value / total) * circumference;
          const dash = `${len} ${circumference - len}`;
          const el = (
            <circle
              key={seg.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-brand-pine font-display text-xl font-semibold">
        {total}
      </text>
    </svg>
  );
}

/** Micro area sparkline. Pass a flat/empty series for a placeholder. */
export function Sparkline({ data, color = "var(--color-data-ink)", width = 120, height = 36 }: { data: number[]; color?: string; width?: number; height?: number }) {
  const series = data.length ? data : [0, 0, 0, 0, 0];
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const range = max - min || 1;
  const step = series.length > 1 ? width / (series.length - 1) : width;
  const points = series.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={color} opacity={0.08} />
    </svg>
  );
}
