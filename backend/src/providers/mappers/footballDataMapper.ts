import type { Standing } from "../../domain/types.js";
import type { TeamCandidate } from "../../domain/teamNameMatch.js";
import { findMatchingTeam } from "../../domain/teamNameMatch.js";
import type { FootballDataStandingsResponse } from "./footballDataTypes.js";
import { logger } from "../../utils/logger.js";

/**
 * Maps football-data.org's standings response into internal `Standing`
 * rows, attached to a `seasonId` the CALLER computes via API-Football's own
 * identity (docs/data-provider.md's `deriveSeasonId`) — never derived from
 * football-data.org's own competition/team ids. See
 * domain/teamNameMatch.ts for why team identity must be resolved by name
 * against `candidates` (teams API-Football's match ingestion already
 * created for this league), not by football-data.org's own team id.
 *
 * A team that doesn't reconcile is skipped and logged, not guessed at —
 * see teamNameMatch.ts's documented limitation.
 */
export function mapStandings(
  response: FootballDataStandingsResponse,
  seasonId: string,
  candidates: TeamCandidate[],
): Standing[] {
  const total = response.standings.find((g) => g.type === "TOTAL");
  if (!total) return [];

  const results: Standing[] = [];
  for (const row of total.table) {
    const match = findMatchingTeam(candidates, row.team.name);
    if (!match) {
      logger.warn(
        { footballDataTeam: row.team.name, competition: response.competition.code },
        "Could not reconcile football-data.org team name to an existing team — skipping this standings row",
      );
      continue;
    }
    results.push({
      seasonId,
      teamId: match.id,
      rank: row.position,
      played: row.playedGames,
      won: row.won,
      drawn: row.draw,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      points: row.points,
      form: row.form ?? undefined,
    });
  }
  return results;
}
