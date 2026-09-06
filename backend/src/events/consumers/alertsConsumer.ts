import type { Redis } from "ioredis";
import type { EventBus } from "../EventBus.js";
import { withDlqHandling } from "../consumerRuntime.js";
import { ConsumerGroups, Topics } from "../topics.js";
import { cacheKeys } from "../../cache/keys.js";
import { logger } from "../../utils/logger.js";

/**
 * Notification-worthy event types (§9/§29) — goals, red cards, and
 * full-time, not every substitution or yellow card. Kept as a small,
 * explicit allowlist rather than "everything" so the seam this hands off
 * to (sports.notification.requested → a future push/email dispatcher,
 * not built yet) starts from a sensible default.
 */
const NOTIFICATION_WORTHY_TYPES = new Set(["goal", "red_card", "fulltime"]);

/**
 * docs/adr/ADR-003, with one refinement made while actually building this
 * (Phase 4): the original consumer-group table didn't assign anyone to fan
 * raw match:event messages out to the WebSocket gateway for the live
 * timeline UI (§3) — only scores/stats had a fan-out path. Since this
 * consumer already reads sports.match.event-created to decide
 * notification-worthiness, it does the timeline fan-out too rather than
 * introducing a fourth consumer group for the same topic.
 */
export async function startAlertsConsumer(bus: EventBus, redis: Redis): Promise<void> {
  await bus.subscribe(
    Topics.MatchEventCreated,
    ConsumerGroups.Alerts,
    withDlqHandling(bus, Topics.MatchEventCreated, async (envelope) => {
      await redis.publish(
        cacheKeys.wsMatchChannel(envelope.matchId),
        JSON.stringify({ type: "match:event", matchId: envelope.matchId, event: envelope.payload }),
      );

      const eventType = (envelope.payload as { type?: string }).type;
      if (eventType && NOTIFICATION_WORTHY_TYPES.has(eventType)) {
        await bus.publish(
          Topics.NotificationRequested,
          envelope.matchId,
          { matchId: envelope.matchId, reason: eventType, priority: eventType === "goal" ? "high" : "normal", payload: envelope.payload },
          "NOTIFICATION_REQUESTED",
        );
      }
    }),
  );
  logger.info({ group: ConsumerGroups.Alerts }, "Alerts consumer started");
}
