export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-primary)] text-sm font-semibold text-white shadow-sm">
        H
      </div>
      {!compact && (
        <div>
          <p className="text-base font-semibold leading-none tracking-wide">Hunter</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Job automation suite</p>
        </div>
      )}
    </div>
  );
}
