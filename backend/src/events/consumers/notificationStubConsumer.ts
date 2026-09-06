import type { EventBus } from "../EventBus.js";
import { withDlqHandling } from "../consumerRuntime.js";
import { ConsumerGroups, Topics } from "../topics.js";
import { logger } from "../../utils/logger.js";

/**
 * §29 — the seam future push/email notification features attach to,
 * built now so the seam exists, not so notifications exist. This consumer
 * does nothing but log: proving sports.notification.requested is real and
 * consumable, without building a dispatch system nothing has asked for yet
 * (the same "avoid overengineering" judgment as ADR-007's provider layer).
 */
export async function startNotificationStubConsumer(bus: EventBus): Promise<void> {
  await bus.subscribe(
    Topics.NotificationRequested,
    ConsumerGroups.NotificationStub,
    withDlqHandling(bus, Topics.NotificationRequested, ConsumerGroups.NotificationStub, async (envelope) => {
      logger.info({ matchId: envelope.matchId, payload: envelope.payload }, "Notification requested (stub — no dispatcher built yet)");
    }),
  );
  logger.info({ group: ConsumerGroups.NotificationStub }, "Notification stub consumer started");
}
