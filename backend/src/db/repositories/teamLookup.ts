import type { QueryClient } from "../client.js";
import type { Team } from "../../domain/types.js";
import { rowToTeam } from "../rowMappers.js";

/** Batch team lookup for enriching match views — one query for N matches' worth of team ids, not N+1. */
export async function getTeamsByIds(client: QueryClient, ids: string[]): Promise<Map<string, Team>> {
  if (ids.length === 0) return new Map();
  const { rows } = await client.query(
    `SELECT t.*, dp.code AS provider_code FROM teams t JOIN data_providers dp ON dp.id = t.provider_id WHERE t.id = ANY($1)`,
    [ids],
  );
  const map = new Map<string, Team>();
  for (const row of rows) {
    const team = rowToTeam(row);
    map.set(team.id, team);
  }
  return map;
}
