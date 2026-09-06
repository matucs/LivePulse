import type { Redis } from "ioredis";
import type { EventBus } from "../EventBus.js";
import { withDlqHandling } from "../consumerRuntime.js";
import { ConsumerGroups, Topics } from "../topics.js";
import { cacheKeys } from "../../cache/keys.js";
import { logger } from "../../utils/logger.js";

/** docs/adr/ADR-003 — same fan-out role as scoresConsumer.ts, for statistics updates specifically (its own consumer group, so a slow/failing stats path can never block score updates reaching the gateway). */
export async function startStatsConsumer(bus: EventBus, redis: Redis): Promise<void> {
  await bus.subscribe(
    Topics.StatisticsUpdated,
    ConsumerGroups.Stats,
    withDlqHandling(bus, Topics.StatisticsUpdated, ConsumerGroups.Stats, async (envelope) => {
      await redis.publish(
        cacheKeys.wsMatchChannel(envelope.matchId),
        JSON.stringify({ type: "match:stats", matchId: envelope.matchId, data: envelope.payload }),
      );
    }),
  );
  logger.info({ group: ConsumerGroups.Stats }, "Stats consumer started");
}
