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
 * All teams API-Football has ever given us (any league) — the candidate
 * set for cross-provider name reconciliation (domain/teamNameMatch.ts).
 *
 * This was originally scoped to "teams that played *this specific* tracked
 * league" — which sounded like the tighter, safer choice, but real-key
 * validation showed it was wrong in practice: `live=all` (ADR-002) only
 * ever returns whatever happens to be live *right now*, and on any given
 * poll, the vast majority of live matches worldwide are lower-tier/regional
 * leagues, not the six specifically tracked ones. A tracked league can go
 * an entire session without a single live match, leaving its per-league
 * candidate pool empty and every standings row unreconcilable — not a
 * name-matching failure, a starved candidate pool. Confirmed directly: 0/18
 * Premier League teams reconciled against a 1-match candidate pool, while
 * "Arsenal" existed correctly among the 485 teams ingested from *other*
 * leagues that happened to be live at that moment.
 *
 * Broadening to "every team ever ingested" trades a small, accepted
 * collision risk (two distinctly-named lower-league clubs normalizing to
 * the same string — unlikely among a few hundred real club names) for a
 * dramatically higher, honest match rate. Still scoped by
 * findMatchingTeam()'s exact-normalized-name requirement — it doesn't
 * fuzzy-match, so a same-named-but-different club would need to collide
 * exactly, not just approximately.
 */
export async function getAllKnownTeams(client: QueryClient): Promise<TeamCandidate[]> {
  const { rows } = await client.query<{ id: string; name: string }>(`SELECT id, name FROM teams`);
  return rows;
}
