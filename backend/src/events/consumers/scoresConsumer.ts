import type { Redis } from "ioredis";
import type { EventBus } from "../EventBus.js";
import { withDlqHandling } from "../consumerRuntime.js";
import { ConsumerGroups, Topics } from "../topics.js";
import { cacheKeys } from "../../cache/keys.js";
import { logger } from "../../utils/logger.js";

/**
 * docs/adr/ADR-003 — reads score/status change events and fans them out to
 * the (Phase 5) WebSocket gateway via Redis pub/sub. Deliberately does NOT
 * redo the Redis live-state write ingestionService.ts already did
 * synchronously (see the ADR-003 Phase 4 addendum for why): consumers add
 * the fan-out step ingestion can't do itself without knowing about the
 * WebSocket gateway, they don't duplicate work ingestion already finished.
 */
export async function startScoresConsumer(bus: EventBus, redis: Redis): Promise<void> {
  const publishToGateway = async (envelope: { matchId: string; eventType: string; payload: unknown }): Promise<void> => {
    await redis.publish(
      cacheKeys.wsMatchChannel(envelope.matchId),
      JSON.stringify({ type: "match:update", matchId: envelope.matchId, eventType: envelope.eventType, data: envelope.payload }),
    );
  };

  await bus.subscribe(
    Topics.MatchScoreChanged,
    ConsumerGroups.Scores,
    withDlqHandling(bus, Topics.MatchScoreChanged, async (envelope) => {
      await publishToGateway(envelope);
    }),
  );
  await bus.subscribe(
    Topics.MatchStatusChanged,
    ConsumerGroups.Scores,
    withDlqHandling(bus, Topics.MatchStatusChanged, async (envelope) => {
      await publishToGateway(envelope);
    }),
  );
  logger.info({ group: ConsumerGroups.Scores }, "Scores consumer started");
}
