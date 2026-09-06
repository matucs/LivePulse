import type { Redis } from "ioredis";
import type { Match, Team } from "../domain/types.js";
import { computeFreshnessSeconds, getLiveMatchState } from "../cache/liveMatchCache.js";
import { getTeamsByIds } from "../db/repositories/teamLookup.js";
import type { QueryClient } from "../db/client.js";

/**
 * §23 — every match response carries a freshness indicator, computed here
 * so no individual route can forget it. Live matches get their freshness
 * from the Redis cache's lastUpdatedAt (the actual last poll); anything
 * else falls back to the Postgres row's updated_at, which is still
 * accurate (just less frequently refreshed by design — finished/upcoming
 * matches aren't re-polled every tick per ADR-002).
 */
export type TeamSummary = Pick<Team, "id" | "name" | "shortName" | "logoUrl">;

export interface MatchView extends Match {
  dataFreshnessSeconds: number;
  isStale: boolean;
  homeTeam: TeamSummary;
  awayTeam: TeamSummary;
}

const STALE_THRESHOLD_SECONDS = 300; // ties to docs/caching.md's freshness table

function toSummary(team: Team | undefined, fallbackId: string): TeamSummary {
  // A missing team row would mean a foreign-key-violating match slipped
  // through ingestion (shouldn't happen — matches.home_team_id/away_team_id
  // are NOT NULL FKs, ADR-005) — falling back to a visible placeholder
  // instead of throwing keeps one bad row from taking down the whole list.
  return team ?? { id: fallbackId, name: "Unknown team", shortName: undefined, logoUrl: undefined };
}

/** Single-match version — one extra team lookup query, fine for a match-detail page load. */
export async function toMatchView(redis: Redis, pool: QueryClient, match: Match): Promise<MatchView> {
  const [view] = await toMatchViews(redis, pool, [match]);
  return view!;
}

/** Batch version — one team lookup query for the whole list, not one per match (used by the live/upcoming/recent list routes). */
export async function toMatchViews(redis: Redis, pool: QueryClient, matches: Match[]): Promise<MatchView[]> {
  const teamIds = [...new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
  const teams = await getTeamsByIds(pool, teamIds);

  return Promise.all(
    matches.map(async (match) => {
      const cached = await getLiveMatchState(redis, match.id);
      const lastUpdatedAt = cached?.lastUpdatedAt ?? match.updatedAt ?? new Date(0).toISOString();
      const dataFreshnessSeconds = computeFreshnessSeconds(lastUpdatedAt);
      return {
        ...match,
        dataFreshnessSeconds,
        isStale: dataFreshnessSeconds > STALE_THRESHOLD_SECONDS,
        homeTeam: toSummary(teams.get(match.homeTeamId), match.homeTeamId),
        awayTeam: toSummary(teams.get(match.awayTeamId), match.awayTeamId),
      };
    }),
  );
}
