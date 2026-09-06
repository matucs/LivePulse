/**
 * §23 — never let the UI imply data is more current than it is. Every
 * place a match's data is shown, this goes with it, driven by the
 * backend's own dataFreshnessSeconds/isStale (docs/caching.md), not
 * guessed client-side.
 */
export function FreshnessIndicator({
  seconds,
  isStale,
  live,
}: {
  seconds: number;
  isStale: boolean;
  /**
   * Phase 5: whether this data is arriving via the WebSocket push
   * (docs/adr/ADR-006) rather than the REST-poll fallback
   * (docs/websocket.md). Optional — MatchCard's list views don't hold a
   * live socket per card, so they simply don't pass this and get the
   * original text.
   */
  live?: boolean;
}) {
  const label = seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;

  if (isStale) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-warn">
        ⚠ Data may be stale — last update {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
      {live ? <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" title="Connected — receiving live updates" /> : null}
      Updated {label}
      {live === false ? <span className="text-text-muted/70">(polling)</span> : null}
    </span>
  );
}
