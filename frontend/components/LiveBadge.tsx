import type { MatchView } from "@/lib/apiClient";

export function StatusBadge({ match }: { match: Pick<MatchView, "status" | "elapsedMinutes"> }) {
  if (match.status === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-live/10 px-2 py-0.5 text-xs font-semibold text-live">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
        LIVE {match.elapsedMinutes !== undefined ? `${match.elapsedMinutes}'` : ""}
      </span>
    );
  }
  if (match.status === "halftime") {
    return (
      <span className="inline-flex items-center rounded-full bg-warn/10 px-2 py-0.5 text-xs font-semibold text-warn">
        HALFTIME
      </span>
    );
  }
  if (match.status === "finished") {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-muted">
        FULL TIME
      </span>
    );
  }
  if (match.status === "postponed" || match.status === "cancelled") {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-muted uppercase">
        {match.status}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-surface-hover px-2 py-0.5 text-xs font-medium text-text-muted">
      Upcoming
    </span>
  );
}
