import type { QueryClient } from "../client.js";
import type { League, MappedFixture } from "../../domain/types.js";
import { getProviderId, getSportId } from "./providerRepository.js";
import { rowToLeague } from "../rowMappers.js";

export async function upsertLeague(client: QueryClient, league: League): Promise<void> {
  const providerId = await getProviderId(client, league.providerId);
  const sportId = await getSportId(client, league.sportCode);
  await client.query(
    `INSERT INTO leagues (id, sport_id, provider_id, external_id, name, country, logo_url, type, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       country = EXCLUDED.country,
       logo_url = EXCLUDED.logo_url,
       updated_at = now()`,
    [league.id, sportId, providerId, league.externalId, league.name, league.country ?? null, league.logoUrl ?? null, league.type],
  );
}

export async function ensureSeason(client: QueryClient, season: MappedFixture["season"]): Promise<void> {
  await client.query(
    `INSERT INTO seasons (id, league_id, label)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [season.id, season.leagueId, season.label],
  );
}

export async function listLeagues(client: QueryClient): Promise<League[]> {
  const { rows } = await client.query(
    `SELECT l.*, dp.code AS provider_code FROM leagues l JOIN data_providers dp ON dp.id = l.provider_id ORDER BY l.name`,
  );
  return rows.map(rowToLeague);
}

/**
 * "Current" season is approximated as the most recent by label (a year
 * string, e.g. "2026") rather than tracked via an is_current flag — a
 * documented simplification (no endpoint call tells us which season is
 * "current" without spending extra request budget on it, ADR-002).
 */
export async function getLatestSeasonId(client: QueryClient, leagueId: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM seasons WHERE league_id = $1 ORDER BY label DESC LIMIT 1`,
    [leagueId],
  );
  return rows[0]?.id ?? null;
}
