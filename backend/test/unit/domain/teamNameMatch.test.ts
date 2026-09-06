import { describe, expect, it } from "vitest";
import { findMatchingTeam, normalizeTeamName } from "../../../src/domain/teamNameMatch.js";

describe("normalizeTeamName", () => {
  it("lowercases and strips common club affixes", () => {
    expect(normalizeTeamName("Manchester United FC")).toBe("manchester united");
    expect(normalizeTeamName("Manchester United")).toBe("manchester united");
  });

  it("strips diacritics", () => {
    expect(normalizeTeamName("Atlético Madrid")).toBe("atletico madrid");
  });

  it("collapses punctuation and whitespace", () => {
    expect(normalizeTeamName("Paris Saint-Germain FC")).toBe("paris saint germain");
  });
});

describe("findMatchingTeam", () => {
  const candidates = [
    { id: "id-1", name: "Manchester United" },
    { id: "id-2", name: "Manchester City" },
    { id: "id-3", name: "Atletico Madrid" },
  ];

  it("matches a football-data.org-style name (with FC suffix) to the API-Football-style candidate", () => {
    const match = findMatchingTeam(candidates, "Manchester United FC");
    expect(match?.id).toBe("id-1");
  });

  it("does not confuse similarly-named teams", () => {
    const match = findMatchingTeam(candidates, "Manchester City FC");
    expect(match?.id).toBe("id-2");
  });

  it("returns null rather than guessing when no candidate matches", () => {
    // The documented limitation: a name that isn't just an affix/accent
    // difference (e.g. a translated club name) does not reconcile, and
    // this must fail closed (null), never attach to the wrong team.
    const match = findMatchingTeam(candidates, "FC Bayern München");
    expect(match).toBeNull();
  });
});
