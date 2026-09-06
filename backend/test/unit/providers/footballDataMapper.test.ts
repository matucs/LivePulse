import { describe, expect, it } from "vitest";
import { mapStandings } from "../../../src/providers/mappers/footballDataMapper.js";
import type { FootballDataStandingsResponse } from "../../../src/providers/mappers/footballDataTypes.js";

// Shape mirrors the real football-data.org v4 /competitions/{code}/standings
// response (docs/adr/ADR-002 addendum) — trimmed to the fields the mapper reads.
function buildResponse(): FootballDataStandingsResponse {
  return {
    competition: { id: 2021, code: "PL", name: "Premier League" },
    standings: [
      {
        type: "HOME", // must be ignored — only TOTAL is mapped (ADR-005: one snapshot per team, not split by venue)
        table: [
          {
            position: 99,
            team: { id: 1, name: "Should Not Appear FC", shortName: null, crest: null },
            playedGames: 1,
            form: null,
            won: 1,
            draw: 0,
            lost: 0,
            points: 3,
            goalsFor: 1,
            goalsAgainst: 0,
            goalDifference: 1,
          },
        ],
      },
      {
        type: "TOTAL",
        table: [
          {
            position: 1,
            team: { id: 65, name: "Manchester City FC", shortName: "Man City", crest: "https://…" },
            playedGames: 10,
            form: "W,W,D,W,L",
            won: 7,
            draw: 2,
            lost: 1,
            points: 23,
            goalsFor: 25,
            goalsAgainst: 10,
            goalDifference: 15,
          },
          {
            position: 2,
            team: { id: 99, name: "FC Bayern München", shortName: null, crest: null }, // deliberately unreconcilable
            playedGames: 10,
            form: null,
            won: 6,
            draw: 3,
            lost: 1,
            points: 21,
            goalsFor: 20,
            goalsAgainst: 12,
            goalDifference: 8,
          },
        ],
      },
    ],
  };
}

describe("mapStandings (football-data.org)", () => {
  const candidates = [
    { id: "internal-man-city", name: "Manchester City" }, // API-Football's own name, no "FC" suffix
  ];

  it("maps only the TOTAL table, ignoring HOME/AWAY splits", () => {
    const result = mapStandings(buildResponse(), "season-1", candidates);
    expect(result.every((r) => r.rank !== 99)).toBe(true);
  });

  it("reconciles a team by normalized name to the caller-supplied candidate's internal id", () => {
    const result = mapStandings(buildResponse(), "season-1", candidates);
    const manCity = result.find((r) => r.points === 23);
    expect(manCity?.teamId).toBe("internal-man-city");
    expect(manCity?.seasonId).toBe("season-1");
    expect(manCity?.rank).toBe(1);
  });

  it("skips a row that cannot be reconciled instead of inventing a new team id", () => {
    const result = mapStandings(buildResponse(), "season-1", candidates);
    expect(result).toHaveLength(1); // Bayern München silently dropped, not guessed at
    expect(result.some((r) => r.points === 21)).toBe(false);
  });
});
