import type { QueryClient } from "../db/client.js";
import type { Standing } from "../domain/types.js";
import { getTeamsByIds } from "../db/repositories/teamLookup.js";
import type { TeamSummary } from "./matchView.js";

export interface StandingView extends Standing {
  team: TeamSummary;
}

/**
 * Same batch-lookup pattern as matchView.ts's toMatchViews — one query for
 * the whole table, not one per row. Team enrichment matters more here than
 * it might look: after the ADR-007 addendum, a standings table routinely
 * mixes api-football- and football-data-sourced team rows in the same
 * response (see teamRepository.getAllKnownTeams's doc comment) — the
 * frontend has no reason to care which, but it does need a name to render.
 */
export async function toStandingViews(pool: QueryClient, standings: Standing[]): Promise<StandingView[]> {
  const teamIds = [...new Set(standings.map((s) => s.teamId))];
  const teams = await getTeamsByIds(pool, teamIds);
  return standings.map((s) => ({
    ...s,
    team: teams.get(s.teamId) ?? { id: s.teamId, name: "Unknown team", shortName: undefined, logoUrl: undefined },
  }));
}
