import { describe, expect, it } from "vitest";
import { buildDomainEvents } from "../../../src/events/domainEvents.js";
import { Topics } from "../../../src/events/topics.js";
import type { DetectedChanges, PreviousMatchState } from "../../../src/ingestion/changeDetector.js";
import type { MappedFixture } from "../../../src/domain/types.js";

function baseMatch(overrides: Partial<MappedFixture["match"]> = {}): MappedFixture {
  return {
    league: {
      id: "league-1",
      providerId: "api-football",
      externalId: "39",
      name: "Premier League",
      sportCode: "football",
      type: "league",
    },
    season: { id: "season-1", leagueId: "league-1", label: "2026" },
    homeTeam: { id: "home-1", providerId: "api-football", externalId: "1", name: "Home FC" },
    awayTeam: { id: "away-1", providerId: "api-football", externalId: "2", name: "Away FC" },
    players: [],
    events: [],
    statistics: [],
    match: {
      id: "match-1",
      providerId: "api-football",
      externalId: "100",
      leagueId: "league-1",
      seasonId: "season-1",
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      kickoffAt: "2026-09-06T15:00:00.000Z",
      status: "live",
      homeScore: 1,
      awayScore: 0,
      elapsedMinutes: 60,
      ...overrides,
    },
  } as MappedFixture;
}

function noChanges(): DetectedChanges {
  return { scoreChanged: false, statusChanged: false, newEvents: [], changedStatistics: [], isNoOp: true };
}

describe("buildDomainEvents", () => {
  it("produces nothing for a genuine no-op poll", () => {
    const mapped = baseMatch();
    const events = buildDomainEvents(mapped, { status: "live", homeScore: 1, awayScore: 0 }, noChanges(), null);
    expect(events).toHaveLength(0);
  });

  it("emits MATCH_SCORE_CHANGED with previous and new scores, plus the coarse MATCH_UPDATED signal", () => {
    const mapped = baseMatch({ homeScore: 2 });
    const previous: PreviousMatchState = { status: "live", homeScore: 1, awayScore: 0 };
    const changes: DetectedChanges = { ...noChanges(), scoreChanged: true, isNoOp: false };

    const events = buildDomainEvents(mapped, previous, changes, null);

    const scoreEvent = events.find((e) => e.topic === Topics.MatchScoreChanged);
    expect(scoreEvent?.payload).toMatchObject({
      matchId: "match-1",
      previousHomeScore: 1,
      previousAwayScore: 0,
      homeScore: 2,
      awayScore: 0,
    });
    expect(events.some((e) => e.topic === Topics.MatchUpdated)).toBe(true);
  });

  it("emits MATCH_STATUS_CHANGED with previousStatus null for a brand-new match (no prior state)", () => {
    const mapped = baseMatch();
    const changes: DetectedChanges = { ...noChanges(), statusChanged: true, isNoOp: false };

    const events = buildDomainEvents(mapped, null, changes, null);

    const statusEvent = events.find((e) => e.topic === Topics.MatchStatusChanged);
    expect(statusEvent?.payload).toMatchObject({ matchId: "match-1", previousStatus: null, newStatus: "live" });
  });

  it("emits one MATCH_EVENT_CREATED per new event, keyed by matchId for per-match ordering (ADR-003)", () => {
    const mapped = baseMatch();
    const changes: DetectedChanges = {
      ...noChanges(),
      isNoOp: false,
      newEvents: [{ matchId: "match-1", type: "goal", minute: 60, teamId: "home-1", sequenceNumber: 5 }],
    };

    const events = buildDomainEvents(mapped, null, changes, null);
    const eventCreated = events.find((e) => e.topic === Topics.MatchEventCreated);
    expect(eventCreated?.key).toBe("match-1");
    expect(eventCreated?.eventType).toBe("MATCH_EVENT_GOAL");
    expect(eventCreated?.payload).toMatchObject({ type: "goal", minute: 60, sequenceNumber: 5 });
  });

  it("includes a synthetic status event (e.g. halftime) alongside real newEvents", () => {
    const mapped = baseMatch({ status: "halftime" });
    const changes: DetectedChanges = { ...noChanges(), isNoOp: false, statusChanged: true };
    const synthetic = { matchId: "match-1", type: "halftime" as const, minute: 45, sequenceNumber: -1 };

    const events = buildDomainEvents(mapped, { status: "live", homeScore: 1, awayScore: 0 }, changes, synthetic);
    const eventCreated = events.filter((e) => e.topic === Topics.MatchEventCreated);
    expect(eventCreated).toHaveLength(1);
    expect(eventCreated[0]?.eventType).toBe("MATCH_EVENT_HALFTIME");
  });

  it("emits STATISTICS_UPDATED per changed team stat line", () => {
    const mapped = baseMatch();
    const changes: DetectedChanges = {
      ...noChanges(),
      isNoOp: false,
      changedStatistics: [{ matchId: "match-1", teamId: "home-1", possessionPct: 55 }],
    };

    const events = buildDomainEvents(mapped, null, changes, null);
    const statsEvent = events.find((e) => e.topic === Topics.StatisticsUpdated);
    expect(statsEvent?.payload).toMatchObject({ teamId: "home-1" });
  });
});
