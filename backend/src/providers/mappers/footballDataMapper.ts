import type { Standing, Team } from "../../domain/types.js";
import type { TeamCandidate } from "../../domain/teamNameMatch.js";
import { findMatchingTeam } from "../../domain/teamNameMatch.js";
import { deriveId } from "../../domain/deriveId.js";
import type { FootballDataStandingsResponse } from "./footballDataTypes.js";
import { logger } from "../../utils/logger.js";

export const PROVIDER_CODE = "football-data" as const;

export interface StandingsMappingResult {
  standings: Standing[];
  /**
   * Teams that couldn't be reconciled to an existing API-Football-sourced
   * team by name (domain/teamNameMatch.ts) — typically because that
   * league hasn't had a live match ingested yet this session, so the team
   * simply doesn't exist in `teams` at all (confirmed during real-key
   * validation: this is the common case, not a rare edge case, since the
   * six tracked leagues only account for a small fraction of matches
   * `live=all` returns at any given moment). These must be upserted
   * *before* the standings rows that reference them are written.
   *
   * This is a deliberate choice over silently dropping the row: the
   * standings data is real, and attributing it to a football-data.org-
   * sourced team (rather than inventing a fake one, or refusing to show
   * it) is honest about provenance. The accepted cost, documented in the
   * ADR-007 addendum, is a temporary duplicate `teams` row once
   * API-Football's own match ingestion later creates "the same" club
   * under its own identity — a real gap, not hidden, with the schema-level
   * fix (a canonical team-identity table) noted as the proper long-term
   * solution.
   */
  newTeams: Team[];
}

/**
 * Maps football-data.org's standings response into internal `Standing`
 * rows, attached to a `seasonId` the CALLER computes via API-Football's own
 * identity (docs/data-provider.md's `deriveSeasonId`) — never derived from
 * football-data.org's own competition/team ids. See
 * domain/teamNameMatch.ts for why team identity must be resolved by name
 * against `candidates` (every team API-Football has ingested so far) before
 * falling back to a football-data.org-sourced team row.
 */
export function mapStandings(
  response: FootballDataStandingsResponse,
  seasonId: string,
  candidates: TeamCandidate[],
): StandingsMappingResult {
  const total = response.standings.find((g) => g.type === "TOTAL");
  if (!total) return { standings: [], newTeams: [] };

  const standings: Standing[] = [];
  const newTeams: Team[] = [];
  for (const row of total.table) {
    const match = findMatchingTeam(candidates, row.team.name);
    let teamId: string;
    if (match) {
      teamId = match.id;
    } else {
      const externalId = String(row.team.id);
      teamId = deriveId(PROVIDER_CODE, "team", externalId);
      newTeams.push({
        id: teamId,
        providerId: PROVIDER_CODE,
        externalId,
        name: row.team.name,
        shortName: row.team.shortName ?? undefined,
        logoUrl: row.team.crest ?? undefined,
      });
      logger.info(
        { footballDataTeam: row.team.name, competition: response.competition.code },
        "No existing API-Football team matched by name — creating a football-data.org-sourced team row for this standings entry",
      );
    }
    standings.push({
      seasonId,
      teamId,
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
  return { standings, newTeams };
}
