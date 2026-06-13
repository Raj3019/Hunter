import { Target } from "lucide-react";

export function BrandMark({
  compact = false,
  eyebrow = "Job automation suite",
}: {
  compact?: boolean;
  eyebrow?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-pine text-white shadow-sm">
        <Target className="h-4 w-4 stroke-[2.5]" />
      </div>
      {!compact && (
        <div className="leading-none">
          <span className="block font-display text-sm font-extrabold tracking-tight text-brand-pine">Hunter.sh</span>
          <span className="-mt-0.5 block font-mono text-[8px] font-bold uppercase tracking-wider text-brand-clay">
            {eyebrow}
          </span>
        </div>
      )}
    </div>
  );
}
