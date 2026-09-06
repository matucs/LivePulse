import type { QueryClient } from "../client.js";

/**
 * Domain types carry a provider *code* (e.g. "api-football"); the schema's
 * FK columns are the data_providers row's uuid (docs/adr/ADR-005). This is
 * the one place that translates between the two, cached in memory since
 * the provider registry changes essentially never (adding a provider is a
 * deploy-time event, not a runtime one).
 */
const codeToIdCache = new Map<string, string>();

export async function getProviderId(client: QueryClient, code: string): Promise<string> {
  const cached = codeToIdCache.get(code);
  if (cached) return cached;

  const { rows } = await client.query<{ id: string }>("SELECT id FROM data_providers WHERE code = $1", [code]);
  const row = rows[0];
  if (!row) {
    throw new Error(`Unknown data provider code "${code}" — is it seeded in data_providers?`);
  }
  codeToIdCache.set(code, row.id);
  return row.id;
}

export async function getSportId(client: QueryClient, code: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>("SELECT id FROM sports WHERE code = $1", [code]);
  const row = rows[0];
  if (!row) {
    throw new Error(`Unknown sport code "${code}" — is it seeded in sports?`);
  }
  return row.id;
}
