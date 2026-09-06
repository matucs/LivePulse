import type { MappedFixture, MatchEvent, MatchStatus, TeamMatchStatistics } from "../domain/types.js";

/**
 * Pure change-detection logic — docs/change-detection.md. Deliberately has
 * no I/O of its own: it's handed "what we knew before" and "what the
 * provider says now," and decides what's actually new. This is what keeps
 * a 5-minute poll of an unchanged match from producing any event at all,
 * and it's what makes this logic unit-testable with plain objects, no
 * database or Redis required (test/unit/ingestion/changeDetector.test.ts).
 */

export interface PreviousMatchState {
  status: MatchStatus;
  homeScore: number;
  awayScore: number;
}

export interface DetectedChanges {
  scoreChanged: boolean;
  statusChanged: boolean;
  /** Events not present in `previousEventSequenceNumbers` — see docs/adr/ADR-005 on sequence_number. */
  newEvents: MatchEvent[];
  /** Only statistics whose values actually differ from `previousStatistics`, per team. */
  changedStatistics: TeamMatchStatistics[];
  /** True if nothing in this tick's poll represents a real change — bookkeeping-only (docs/ingestion.md). */
  isNoOp: boolean;
}

function statisticsEqual(a: TeamMatchStatistics | undefined, b: TeamMatchStatistics): boolean {
  if (!a) return false;
  const keys: (keyof TeamMatchStatistics)[] = [
    "possessionPct",
    "shotsTotal",
    "shotsOnTarget",
    "corners",
    "fouls",
    "yellowCards",
    "redCards",
    "offsides",
  ];
  return keys.every((k) => a[k] === b[k]);
}

export function detectChanges(
  previous: PreviousMatchState | null,
  mapped: MappedFixture,
  previousEventSequenceNumbers: ReadonlySet<number>,
  previousStatistics: readonly TeamMatchStatistics[] = [],
): DetectedChanges {
  const scoreChanged =
    previous === null ||
    previous.homeScore !== mapped.match.homeScore ||
    previous.awayScore !== mapped.match.awayScore;

  const statusChanged = previous === null || previous.status !== mapped.match.status;

  const newEvents = mapped.events.filter((e) => !previousEventSequenceNumbers.has(e.sequenceNumber));

  const statsByTeam = new Map(previousStatistics.map((s) => [s.teamId, s]));
  const changedStatistics = mapped.statistics.filter((s) => !statisticsEqual(statsByTeam.get(s.teamId), s));

  const isNoOp = !scoreChanged && !statusChanged && newEvents.length === 0 && changedStatistics.length === 0;

  return { scoreChanged, statusChanged, newEvents, changedStatistics, isNoOp };
}

/** Synthetic halftime/fulltime timeline markers (docs/change-detection.md) — not present in the provider's own event list. */
export function synthesizeStatusEvent(mapped: MappedFixture, previousStatus: MatchStatus | null): MatchEvent | null {
  if (previousStatus === mapped.match.status) return null;
  if (mapped.match.status === "halftime") {
    return {
      matchId: mapped.match.id,
      type: "halftime",
      minute: mapped.match.elapsedMinutes ?? 45,
      sequenceNumber: hashSyntheticEvent(mapped.match.id, "halftime"),
    };
  }
  if (mapped.match.status === "finished" && previousStatus !== null) {
    return {
      matchId: mapped.match.id,
      type: "fulltime",
      minute: mapped.match.elapsedMinutes ?? 90,
      sequenceNumber: hashSyntheticEvent(mapped.match.id, "fulltime"),
    };
  }
  return null;
}

function hashSyntheticEvent(matchId: string, marker: string): number {
  // Synthetic events use a reserved, obviously-non-real-event range so they
  // can never collide with a real provider event's derived sequence number
  // (eventMapper.ts uses the full 31-bit range; this uses a small fixed
  // offset instead — collisions are structurally impossible, not just unlikely).
  let hash = 0;
  const input = `${matchId}:${marker}`;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) | 0;
  return -(Math.abs(hash) % 1_000_000) - 1; // negative range, reserved for synthetic markers
}
