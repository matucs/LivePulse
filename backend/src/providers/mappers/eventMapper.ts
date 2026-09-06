import type { ApiFootballEvent } from "./apiFootballTypes.js";
import type { MatchEventType } from "../../domain/types.js";

export function mapEventType(raw: Pick<ApiFootballEvent, "type" | "detail">): MatchEventType {
  const type = raw.type.toLowerCase();
  const detail = raw.detail.toLowerCase();

  if (type === "goal") return "goal";
  if (type === "card") return detail.includes("red") ? "red_card" : "yellow_card";
  if (type === "subst" || type === "substitution") return "substitution";
  if (type === "var") return "var";

  throw new Error(`Unrecognized API-Football event type/detail: "${raw.type}"/"${raw.detail}"`);
}

/**
 * FNV-1a 32-bit, masked to a positive int4 (Postgres `int` is signed,
 * max 2^31-1). Deterministic: the same (minute, extraMinute, type, team,
 * player) always produces the same number, which is the whole point —
 * see docs/change-detection.md and match_events.sequence_number in
 * docs/adr/ADR-005. Collisions within one match are astronomically
 * unlikely at real event volumes (a match has dozens of events, not
 * millions) and the schema's UNIQUE(match_id, sequence_number) constraint
 * would surface one loudly (an insert conflict) rather than silently
 * dropping data, which is the correct failure mode if it ever happened.
 */
export function deriveEventSequenceNumber(key: {
  minute: number;
  extraMinute: number | null;
  type: string;
  teamExternalId: number;
  playerExternalId: number | null;
}): number {
  const input = [key.minute, key.extraMinute ?? "", key.type, key.teamExternalId, key.playerExternalId ?? ""].join(
    "|",
  );

  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0) & 0x7fffffff;
}
