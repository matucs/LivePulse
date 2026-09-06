import { describe, expect, it } from "vitest";
import { detectChanges, synthesizeStatusEvent, type PreviousMatchState } from "../../../src/ingestion/changeDetector.js";
import { mapFixture } from "../../../src/providers/mappers/fixtureMapper.js";
import fixtureRaw from "../../fixtures/fixture-live.json" with { type: "json" };
import eventsRaw from "../../fixtures/events.json" with { type: "json" };
import statisticsRaw from "../../fixtures/statistics.json" with { type: "json" };
import type { ApiFootballEvent, ApiFootballFixture, ApiFootballStatistics } from "../../../src/providers/mappers/apiFootballTypes.js";

const fixture = fixtureRaw as ApiFootballFixture;
const events = eventsRaw as ApiFootballEvent[];
const statistics = statisticsRaw as ApiFootballStatistics[];

describe("detectChanges — the §9 core requirement", () => {
  it("treats the first-ever poll of a match as a change (no previous state)", () => {
    const mapped = mapFixture(fixture, events, statistics);
    const result = detectChanges(null, mapped, new Set());
    expect(result.isNoOp).toBe(false);
    expect(result.scoreChanged).toBe(true);
    expect(result.statusChanged).toBe(true);
    expect(result.newEvents).toHaveLength(4);
  });

  it("produces exactly one score-changed signal when the score actually changes (1-0 -> 2-0 example from the spec)", () => {
    const mapped = mapFixture(fixture, [], []); // home 2, away 1
    const previous: PreviousMatchState = { status: "live", homeScore: 1, awayScore: 1 };
    const result = detectChanges(previous, mapped, new Set());
    expect(result.scoreChanged).toBe(true);
    expect(result.statusChanged).toBe(false);
  });

  it("polling the identical state twice produces zero changes (isNoOp)", () => {
    const mapped = mapFixture(fixture, events, statistics);
    const previous: PreviousMatchState = {
      status: mapped.match.status,
      homeScore: mapped.match.homeScore,
      awayScore: mapped.match.awayScore,
    };
    const previousEventSeqs = new Set(mapped.events.map((e) => e.sequenceNumber));
    const result = detectChanges(previous, mapped, previousEventSeqs, mapped.statistics);

    expect(result.isNoOp).toBe(true);
    expect(result.newEvents).toHaveLength(0);
    expect(result.changedStatistics).toHaveLength(0);
  });

  it("detects only the new event when one more event appears since last poll", () => {
    const mapped = mapFixture(fixture, events, statistics);
    const alreadySeen = new Set(mapped.events.slice(0, 3).map((e) => e.sequenceNumber));
    const result = detectChanges(
      { status: mapped.match.status, homeScore: mapped.match.homeScore, awayScore: mapped.match.awayScore },
      mapped,
      alreadySeen,
      mapped.statistics,
    );
    expect(result.newEvents).toHaveLength(1);
    expect(result.newEvents[0]!.minute).toBe(72);
  });

  it("detects a statistics change only for the team whose numbers actually moved", () => {
    const mapped = mapFixture(fixture, [], statistics);
    const staleStats = mapped.statistics.map((s) => (s.teamId === mapped.homeTeam.id ? { ...s, corners: 1 } : s));
    const result = detectChanges(
      { status: mapped.match.status, homeScore: mapped.match.homeScore, awayScore: mapped.match.awayScore },
      mapped,
      new Set(),
      staleStats,
    );
    expect(result.changedStatistics).toHaveLength(1);
    expect(result.changedStatistics[0]!.teamId).toBe(mapped.homeTeam.id);
  });

  it("detects a status change (e.g. live -> finished) independently of score", () => {
    const mapped = mapFixture(fixture, [], []);
    const previous: PreviousMatchState = { status: "halftime", homeScore: 2, awayScore: 1 };
    const result = detectChanges(previous, mapped, new Set());
    expect(result.statusChanged).toBe(true);
    expect(result.scoreChanged).toBe(false);
  });
});

describe("synthesizeStatusEvent", () => {
  it("emits a halftime marker when status transitions into halftime", () => {
    const mapped = mapFixture({ ...fixture, fixture: { ...fixture.fixture, status: { long: "Halftime", short: "HT", elapsed: 45 } } });
    const event = synthesizeStatusEvent(mapped, "live");
    expect(event?.type).toBe("halftime");
  });

  it("emits nothing when status hasn't changed", () => {
    const mapped = mapFixture(fixture);
    const event = synthesizeStatusEvent(mapped, mapped.match.status);
    expect(event).toBeNull();
  });

  it("never collides with a real event's sequence number range", () => {
    const mapped = mapFixture(fixture, events);
    const synthetic = synthesizeStatusEvent(mapped, "scheduled");
    const realSeqNumbers = mapped.events.map((e) => e.sequenceNumber);
    if (synthetic) {
      expect(realSeqNumbers).not.toContain(synthetic.sequenceNumber);
      expect(synthetic.sequenceNumber).toBeLessThan(0);
    }
  });
});
