/**
 * §23 — never let the UI imply data is more current than it is. Every
 * place a match's data is shown, this goes with it, driven by the
 * backend's own dataFreshnessSeconds/isStale (docs/caching.md), not
 * guessed client-side.
 */
export function FreshnessIndicator({
  seconds,
  isStale,
}: {
  seconds: number;
  isStale: boolean;
}) {
  const label = seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;

  if (isStale) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
        ⚠ Data may be stale — last update {label}
      </span>
    );
  }
  return <span className="text-xs text-text-muted">Updated {label}</span>;
}
