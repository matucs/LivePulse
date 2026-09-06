import { describe, expect, it } from "vitest";
import { mapEvents, mapFixture, mapPlayersFromEvents, mapStandings, deriveSeasonId } from "../../../src/providers/mappers/fixtureMapper.js";
import { deriveId } from "../../../src/domain/deriveId.js";
import fixtureRaw from "../../fixtures/fixture-live.json" with { type: "json" };
import eventsRaw from "../../fixtures/events.json" with { type: "json" };
import statisticsRaw from "../../fixtures/statistics.json" with { type: "json" };
import standingsRaw from "../../fixtures/standings.json" with { type: "json" };
import type { ApiFootballEvent, ApiFootballFixture, ApiFootballStatistics } from "../../../src/providers/mappers/apiFootballTypes.js";

const fixture = fixtureRaw as ApiFootballFixture;
const events = eventsRaw as ApiFootballEvent[];
const statistics = statisticsRaw as ApiFootballStatistics[];

describe("mapFixture", () => {
  it("maps a live fixture to the internal domain model", () => {
    const result = mapFixture(fixture, events, statistics);

    expect(result.match.status).toBe("live");
    expect(result.match.elapsedMinutes).toBe(72);
    expect(result.match.homeScore).toBe(2);
    expect(result.match.awayScore).toBe(1);
    expect(result.match.externalId).toBe("215662");
    expect(result.match.providerId).toBe("api-football");
    expect(result.homeTeam.name).toBe("Defensa Y Justicia");
    expect(result.awayTeam.name).toBe("Aldosivi");
  });

  it("derives the same match id every time for the same external id (idempotent mapping)", () => {
    const first = mapFixture(fixture);
    const second = mapFixture(fixture);
    expect(first.match.id).toBe(second.match.id);
    expect(first.match.id).toBe(deriveId("api-football", "match", "215662"));
  });

  it("derives different ids for different providers given the same external id", () => {
    const id = deriveId("api-football", "match", "215662");
    const otherProviderId = deriveId("thesportsdb", "match", "215662");
    expect(id).not.toBe(otherProviderId);
  });

  it("links home and away teams to the match via their derived ids", () => {
    const result = mapFixture(fixture);
    expect(result.match.homeTeamId).toBe(result.homeTeam.id);
    expect(result.match.awayTeamId).toBe(result.awayTeam.id);
    expect(result.homeTeam.id).not.toBe(result.awayTeam.id);
  });

  it("maps statistics with % values parsed to numbers, and unmapped stat types dropped", () => {
    const result = mapFixture(fixture, [], statistics);
    const home = result.statistics.find((s) => s.teamId === result.homeTeam.id)!;
    expect(home.possessionPct).toBe(58);
    expect(home.shotsOnTarget).toBe(6);
    expect(home.redCards).toBeUndefined(); // null in source -> absent, not 0
  });
});

describe("mapEvents", () => {
  it("maps goal/card events with correct type, minute and team", () => {
    const matchId = "match-1";
    const mapped = mapEvents(matchId, events);

    expect(mapped).toHaveLength(4);
    expect(mapped[0]!.type).toBe("goal");
    expect(mapped[0]!.minute).toBe(25);
    expect(mapped[1]!.type).toBe("yellow_card");
    expect(mapped[2]!.type).toBe("goal");
    expect(mapped[2]!.assistPlayerId).toBeDefined();
  });

  it("produces a stable sequenceNumber for the same event, and different ones for different events", () => {
    const mapped = mapEvents("match-1", events);
    const again = mapEvents("match-1", events);
    expect(mapped[0]!.sequenceNumber).toBe(again[0]!.sequenceNumber);

    const uniqueSequenceNumbers = new Set(mapped.map((e) => e.sequenceNumber));
    expect(uniqueSequenceNumbers.size).toBe(mapped.length);
  });

  it("re-mapping the identical raw event list is idempotent at the event level", () => {
    // Simulates polling the same match twice with no new events (docs/change-detection.md):
    // every field of every mapped event must be identical, not just the count.
    const first = mapEvents("match-1", events);
    const second = mapEvents("match-1", events);
    expect(second).toEqual(first);
  });
});

describe("mapPlayersFromEvents", () => {
  it("extracts one stub per distinct player, including assist-providers", () => {
    const players = mapPlayersFromEvents(events);
    // events.json: 4 scorers/carded players + 1 assist provider, all distinct
    expect(players).toHaveLength(5);
    expect(players.every((p) => p.name && p.id && p.teamId)).toBe(true);
  });

  it("every event's player and assist ends up with a matching stub (the FK this exists to satisfy)", () => {
    const players = mapPlayersFromEvents(events);
    const stubIds = new Set(players.map((p) => p.id));
    const mappedEvents = mapEvents("match-1", events);
    for (const e of mappedEvents) {
      if (e.playerId) expect(stubIds.has(e.playerId)).toBe(true);
      if (e.assistPlayerId) expect(stubIds.has(e.assistPlayerId)).toBe(true);
    }
  });

  it("does not produce duplicate stubs for a player involved in multiple events", () => {
    const withRepeat = [...events, events[0]!]; // same scorer appears again (e.g. a brace)
    const players = mapPlayersFromEvents(withRepeat);
    const ids = players.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("mapStandings", () => {
  it("maps standings rows with correct rank and record", () => {
    const seasonId = deriveSeasonId("128", 2026);
    const rows = standingsRaw.response[0]!.league.standings[0]!;
    const mapped = mapStandings(seasonId, rows as never);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]!.rank).toBe(1);
    expect(mapped[0]!.points).toBe(28);
    expect(mapped[0]!.won).toBe(9);
    expect(mapped[0]!.goalsFor).toBe(24);
  });
});
