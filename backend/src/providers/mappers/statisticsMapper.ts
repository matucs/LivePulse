import type { ApiFootballStatItem, ApiFootballStatistics } from "./apiFootballTypes.js";
import type { TeamMatchStatistics } from "../../domain/types.js";
import { deriveId } from "../../domain/deriveId.js";

/**
 * API-Football returns statistics as a loose array of {type, value} pairs
 * per team rather than a fixed object — the set of `type` strings present
 * isn't guaranteed identical across matches/leagues (lower-tier competitions
 * often omit some). This normalizes that into the fixed
 * TeamMatchStatistics shape (docs/adr/ADR-005), defaulting anything absent
 * to undefined rather than 0 — "not reported" and "zero" are different
 * facts and the UI (§3) needs to be able to tell them apart.
 */
const TYPE_KEY_MAP: Record<string, keyof TeamMatchStatistics> = {
  "Ball Possession": "possessionPct",
  "Total Shots": "shotsTotal",
  "Shots on Goal": "shotsOnTarget",
  "Corner Kicks": "corners",
  Fouls: "fouls",
  "Yellow Cards": "yellowCards",
  "Red Cards": "redCards",
  Offsides: "offsides",
};

function parseStatValue(raw: ApiFootballStatItem["value"]): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return raw;
  const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(raw.trim());
  return match ? Number(match[1]) : undefined;
}

export function mapStatistics(
  matchId: string,
  providerCode: string,
  raw: ApiFootballStatistics[],
): TeamMatchStatistics[] {
  return raw.map((teamStats) => {
    const stats: TeamMatchStatistics = {
      matchId,
      teamId: deriveId(providerCode, "team", String(teamStats.team.id)),
    };
    for (const item of teamStats.statistics) {
      const key = TYPE_KEY_MAP[item.type];
      if (!key) continue; // unmapped stat types (e.g. "Goalkeeper Saves") are intentionally not modeled yet
      const value = parseStatValue(item.value);
      if (value !== undefined) {
        (stats as unknown as Record<string, number>)[key] = value;
      }
    }
    return stats;
  });
}
