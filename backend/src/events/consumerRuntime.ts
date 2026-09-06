import type { EventBus, EventHandler } from "./EventBus.js";
import { dlqTopic, type Topic } from "./topics.js";
import { logger } from "../utils/logger.js";
import { eventProcessingLatency, eventsFailed, eventsProcessed } from "../observability/metrics.js";

/**
 * Retry-then-DLQ wrapper (docs/adr/ADR-003) — deliberately implemented
 * once, here, rather than inside each EventBus implementation, because
 * this policy (3 attempts, 1s/4s/16s backoff, then publish to `<topic>.dlq`
 * and move on) is a consumer-side concern, not a transport concern. Both
 * KafkaEventBus and RedisStreamsEventBus get identical retry/DLQ behavior
 * for free by having their consumers wrapped in this, which is exactly the
 * kind of thing the EventBus abstraction (ADR-007-style reasoning, applied
 * to the event bus rather than the sports provider) is supposed to buy.
 *
 * A message that exhausts retries is swallowed here (not rethrown) — a
 * poison message must not block the rest of the partition forever; it's
 * logged and pushed to the DLQ so it's inspectable (Kafka UI locally),
 * never silently dropped.
 */
export function withDlqHandling(
  bus: EventBus,
  topic: Topic,
  consumerGroup: string,
  handler: EventHandler,
  maxAttempts = 3,
): EventHandler {
  return async (envelope, raw) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await handler(envelope, raw);
        eventsProcessed.inc({ consumer_group: consumerGroup, topic });
        // §21's event_processing_latency: from the event's own occurredAt
        // (set at detection time, docs/kafka.md's envelope) to this
        // consumer finishing — the true end-to-end figure, not just this
        // handler's own execution time.
        const latencySeconds = (Date.now() - Date.parse(envelope.occurredAt)) / 1000;
        if (Number.isFinite(latencySeconds) && latencySeconds >= 0) {
          eventProcessingLatency.observe({ consumer_group: consumerGroup }, latencySeconds);
        }
        return;
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          const delayMs = [1000, 4000, 16000][attempt - 1];
          logger.warn({ topic, attempt, eventId: envelope.eventId, err: String(err) }, "Consumer handler failed — retrying");
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    logger.error(
      { topic, eventId: envelope.eventId, attempts: maxAttempts, err: String(lastError) },
      "Consumer handler exhausted retries — publishing to DLQ",
    );
    eventsFailed.inc({ consumer_group: consumerGroup, topic });
    await bus.publish(
      dlqTopic(topic),
      raw.key,
      {
        originalTopic: topic,
        originalPayload: envelope,
        error: String(lastError),
        retryCount: maxAttempts,
        failedAt: new Date().toISOString(),
      },
      "DLQ",
    );
  };
}
