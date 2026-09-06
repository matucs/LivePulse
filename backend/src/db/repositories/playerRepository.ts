import type { QueryClient } from "../client.js";
import type { Player } from "../../domain/types.js";
import { getProviderId } from "./providerRepository.js";

/**
 * Upserts a minimal player stub (id/name/team only — see MappedFixture's
 * `players` field for why). Deliberately does not clobber position/
 * nationality/birth_date on conflict, since this path never has that data
 * to begin with; a future dedicated /players sync would own those fields.
 */
export async function upsertPlayerStub(client: QueryClient, player: Player): Promise<void> {
  const providerId = await getProviderId(client, player.providerId);
  await client.query(
    `INSERT INTO players (id, provider_id, external_id, team_id, name)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       team_id = EXCLUDED.team_id,
       name = EXCLUDED.name`,
    [player.id, providerId, player.externalId, player.teamId ?? null, player.name],
  );
}
