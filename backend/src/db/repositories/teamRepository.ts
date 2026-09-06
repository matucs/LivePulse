import type { QueryClient } from "../client.js";
import type { Team } from "../../domain/types.js";
import { getProviderId } from "./providerRepository.js";
import type { TeamCandidate } from "../../domain/teamNameMatch.js";

export async function upsertTeam(client: QueryClient, team: Team): Promise<void> {
  const providerId = await getProviderId(client, team.providerId);
  await client.query(
    `INSERT INTO teams (id, provider_id, external_id, name, short_name, country, logo_url, founded_year, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       short_name = EXCLUDED.short_name,
       country = EXCLUDED.country,
       logo_url = EXCLUDED.logo_url,
       founded_year = EXCLUDED.founded_year,
       updated_at = now()`,
    [
      team.id,
      providerId,
      team.externalId,
      team.name,
      team.shortName ?? null,
      team.country ?? null,
      team.logoUrl ?? null,
      team.foundedYear ?? null,
    ],
  );
}

/**
 * Teams that have actually appeared in a match for this league — the
 * candidate set for cross-provider name reconciliation
 * (domain/teamNameMatch.ts), bounded deliberately so a standings poll can
 * only attach to a team already known (via API-Football match ingestion)
 * to play in that specific league, not any team ever ingested anywhere.
 */
export async function getTeamsPlayedInLeague(client: QueryClient, leagueId: string): Promise<TeamCandidate[]> {
  const { rows } = await client.query<{ id: string; name: string }>(
    `SELECT DISTINCT t.id, t.name
     FROM teams t
     WHERE t.id IN (
       SELECT home_team_id FROM matches WHERE league_id = $1
       UNION
       SELECT away_team_id FROM matches WHERE league_id = $1
     )`,
    [leagueId],
  );
  return rows;
}
