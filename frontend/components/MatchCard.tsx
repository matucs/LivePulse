import Link from "next/link";
import type { MatchView } from "@/lib/apiClient";
import { StatusBadge } from "./LiveBadge";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { TeamBadge } from "./TeamBadge";

export function MatchCard({ match }: { match: MatchView }) {
  const kickoff = new Date(match.kickoffAt);
  const showScore = match.status !== "scheduled" && match.status !== "postponed" && match.status !== "cancelled";

  return (
    <Link
      href={`/match/${match.id}`}
      className="block rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-hover"
    >
      <div className="mb-3 flex items-center justify-between">
        <StatusBadge match={match} />
        <span className="text-xs text-text-muted">
          {kickoff.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
          {kickoff.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <TeamBadge team={match.homeTeam} />
          {showScore && <span className="text-lg font-bold tabular-nums">{match.homeScore}</span>}
        </div>
        <div className="flex items-center justify-between gap-3">
          <TeamBadge team={match.awayTeam} />
          {showScore && <span className="text-lg font-bold tabular-nums">{match.awayScore}</span>}
        </div>
      </div>

      {match.status === "live" || match.status === "halftime" ? (
        <div className="mt-3">
          <FreshnessIndicator seconds={match.dataFreshnessSeconds} isStale={match.isStale} />
        </div>
      ) : null}
    </Link>
  );
}
