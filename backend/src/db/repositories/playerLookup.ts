import type { QueryClient } from "../client.js";

export interface PlayerSummary {
  id: string;
  name: string;
}

export async function getPlayersByIds(client: QueryClient, ids: string[]): Promise<Map<string, PlayerSummary>> {
  if (ids.length === 0) return new Map();
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM players WHERE id = ANY($1)`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r]));
}
