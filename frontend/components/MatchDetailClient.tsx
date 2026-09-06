"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";
import { StatusBadge } from "./LiveBadge";
import { FreshnessIndicator } from "./FreshnessIndicator";
import { TeamBadge } from "./TeamBadge";
import { Timeline } from "./Timeline";
import { StatisticsPanel } from "./StatisticsPanel";

/**
 * §3's match detail page. Polls every 15s while data is live-relevant
 * (Phase 3 mechanism — refetchInterval; Phase 5 swaps this for WebSocket
 * push per docs/adr/ADR-006 without changing anything below this file).
 */
export function MatchDetailClient({ matchId }: { matchId: string }) {
  const matchQuery = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => api.match(matchId),
    refetchInterval: 15_000,
  });
  const eventsQuery = useQuery({
    queryKey: ["match", matchId, "events"],
    queryFn: () => api.matchEvents(matchId),
    refetchInterval: 15_000,
  });
  const statsQuery = useQuery({
    queryKey: ["match", matchId, "statistics"],
    queryFn: () => api.matchStatistics(matchId),
    refetchInterval: 15_000,
  });

  if (matchQuery.isLoading) {
    return <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />;
  }
  if (matchQuery.isError || !matchQuery.data) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-sm text-text-muted">
        Couldn&apos;t load this match. It may not exist, or LivePulse&apos;s backend is temporarily unreachable.
      </p>
    );
  }

  const match = matchQuery.data;
  const events = eventsQuery.data?.events ?? [];
  const stats = statsQuery.data?.statistics ?? [];
  const homeStats = stats.find((s) => s.teamId === match.homeTeamId);
  const awayStats = stats.find((s) => s.teamId === match.awayTeamId);

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <StatusBadge match={match} />
          {match.venue ? <span className="text-xs text-text-muted">{match.venue}</span> : null}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="text-center sm:text-left">
            <TeamBadge team={match.homeTeam} size={40} />
          </div>
          <div className="flex items-center gap-3 text-4xl font-bold tabular-nums">
            <span>{match.homeScore}</span>
            <span className="text-text-muted">-</span>
            <span>{match.awayScore}</span>
          </div>
          <div className="text-center sm:text-right">
            <TeamBadge team={match.awayTeam} size={40} />
          </div>
        </div>

        {match.status === "live" || match.status === "halftime" ? (
          <div className="mt-4 flex justify-center">
            <FreshnessIndicator seconds={match.dataFreshnessSeconds} isStale={match.isStale} />
          </div>
        ) : null}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Timeline</h2>
        <div className="rounded-lg border border-border bg-surface p-4">
          <Timeline events={events} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-muted">Statistics</h2>
        <div className="rounded-lg border border-border bg-surface p-4">
          <StatisticsPanel home={homeStats} away={awayStats} />
        </div>
      </section>
    </div>
  );
}
