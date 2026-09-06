import { v5 as uuidv5 } from "uuid";

/**
 * LivePulse's internal ids for provider-sourced entities are deterministic:
 * UUIDv5(namespace, `${providerCode}:${entityKind}:${externalId}`).
 *
 * Why: it lets the mapper (providers/mappers/*) produce the *final*
 * internal id for a team/match/player without a database round-trip first
 * — the id is a pure function of (provider, kind, external id). Upserts
 * become `INSERT ... ON CONFLICT (id) DO UPDATE` instead of a two-step
 * "look up external_id, then insert-or-update by internal id" dance, and
 * the mapper stays a pure function, which is what makes it unit-testable
 * against fixtures without a database (test/unit/providers).
 *
 * The `UNIQUE (provider_id, external_id)` constraint in the schema
 * (docs/adr/ADR-005) is kept anyway, as a safety net — if this derivation
 * ever collided or changed, the constraint still prevents duplicate rows.
 */
const LIVEPULSE_NAMESPACE = "b6f1e639-5f57-4c3b-8e9b-3a6c9b2b6a10";

export function deriveId(providerCode: string, entityKind: string, externalId: string): string {
  return uuidv5(`${providerCode}:${entityKind}:${externalId}`, LIVEPULSE_NAMESPACE);
}
