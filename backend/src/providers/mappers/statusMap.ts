import type { MatchStatus } from "../../domain/types.js";

/**
 * API-Football's fixture.status.short codes → LivePulse's internal
 * MatchStatus (docs/adr/ADR-005). Deliberately a closed mapping — an
 * unrecognized code is a mapping bug we want to see immediately (thrown),
 * not silently coerced to some default status.
 */
const STATUS_MAP: Record<string, MatchStatus> = {
  TBD: "scheduled",
  NS: "scheduled",
  "1H": "live",
  "2H": "live",
  ET: "live",
  BT: "live",
  P: "live",
  LIVE: "live",
  HT: "halftime",
  FT: "finished",
  AET: "finished",
  PEN: "finished",
  PST: "postponed",
  SUSP: "postponed",
  INT: "postponed",
  CANC: "cancelled",
  ABD: "cancelled",
  AWD: "finished",
  WO: "finished",
};

export function mapStatus(shortCode: string): MatchStatus {
  const status = STATUS_MAP[shortCode];
  if (!status) {
    throw new Error(`Unrecognized API-Football status code: "${shortCode}"`);
  }
  return status;
}
