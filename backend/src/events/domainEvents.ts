import type { MappedFixture, MatchEvent } from "../domain/types.js";
import type { DetectedChanges, PreviousMatchState } from "../ingestion/changeDetector.js";
import { Topics, type Topic } from "./topics.js";

export interface PublishableEvent {
  topic: Topic;
  key: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Pure mapping from "what changed" (changeDetector.ts's output — already
 * the thing that guarantees an unchanged poll produces nothing here) to
 * the domain events docs/kafka.md documents. No I/O, no EventBus
 * dependency — ingestionService.ts calls `bus.publish()` once per entry
 * this returns; this function is what's unit-tested
 * (test/unit/events/domainEvents.test.ts), not the publishing itself.
 */
export function buildDomainEvents(
  mapped: MappedFixture,
  previous: PreviousMatchState | null,
  changes: DetectedChanges,
  synthetic: MatchEvent | null,
): PublishableEvent[] {
  const matchId = mapped.match.id;
  const events: PublishableEvent[] = [];

  if (changes.scoreChanged) {
    events.push({
      topic: Topics.MatchScoreChanged,
      key: matchId,
      eventType: "MATCH_SCORE_CHANGED",
      payload: {
        matchId,
        previousHomeScore: previous?.homeScore ?? null,
        previousAwayScore: previous?.awayScore ?? null,
        homeScore: mapped.match.homeScore,
        awayScore: mapped.match.awayScore,
      },
    });
  }

  if (changes.statusChanged) {
    events.push({
      topic: Topics.MatchStatusChanged,
      key: matchId,
      eventType: "MATCH_STATUS_CHANGED",
      payload: {
        matchId,
        previousStatus: previous?.status ?? null,
        newStatus: mapped.match.status,
      },
    });
  }

  for (const event of [...changes.newEvents, ...(synthetic ? [synthetic] : [])]) {
    events.push({
      topic: Topics.MatchEventCreated,
      key: matchId,
      eventType: `MATCH_EVENT_${event.type.toUpperCase()}`,
      payload: {
        matchId,
        type: event.type,
        minute: event.minute,
        teamId: event.teamId ?? null,
        playerId: event.playerId ?? null,
        sequenceNumber: event.sequenceNumber,
      },
    });
  }

  for (const stats of changes.changedStatistics) {
    events.push({
      topic: Topics.StatisticsUpdated,
      key: matchId,
      eventType: "STATISTICS_UPDATED",
      payload: { matchId, teamId: stats.teamId, statistics: stats },
    });
  }

  // Coarse "something about this match changed" signal (docs/kafka.md) —
  // only emitted alongside a real change above, never on a no-op tick.
  if (events.length > 0) {
    events.push({
      topic: Topics.MatchUpdated,
      key: matchId,
      eventType: "MATCH_UPDATED",
      payload: { matchId, ...mapped.match },
    });
  }

  return events;
}
