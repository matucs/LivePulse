import { Kafka, logLevel, type Admin, type Consumer, type Producer } from "kafkajs";
import type { EventBus, EventHandler } from "./EventBus.js";
import { buildEnvelope } from "./EventBus.js";
import { ALL_TOPICS, dlqTopic } from "./topics.js";
import { logger } from "../utils/logger.js";
import { kafkaConsumerLag } from "../observability/metrics.js";

export interface KafkaEventBusOptions {
  brokers: string[];
  clientId?: string;
  /** §21's kafka_consumer_lag poll interval — Kafka-only, Redis Streams has no equivalent concept (docs/kafka.md). */
  lagPollIntervalMs?: number;
}

/**
 * Real Kafka (docs/adr/ADR-003) — local dev (Docker Compose) and the
 * documented Production Mode transport (docs/adr/ADR-008). Topics
 * (including DLQ topics) are created explicitly on `start()`, matching
 * `KAFKA_AUTO_CREATE_TOPICS_ENABLE: false` in docker-compose.yml — no
 * topic should exist that isn't in docs/kafka.md's table.
 */
export class KafkaEventBus implements EventBus {
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumers: Consumer[] = [];
  /** (groupId, topic) pairs actually subscribed via subscribe() below — the lag poller reports exactly these, not a guessed cross-product. */
  private readonly activeSubscriptions = new Set<string>();
  private lagPollTimer?: NodeJS.Timeout;

  constructor(private readonly opts: KafkaEventBusOptions) {
    this.kafka = new Kafka({
      clientId: opts.clientId ?? "livepulse-backend",
      brokers: opts.brokers,
      logLevel: logLevel.NOTHING, // pino (utils/logger.ts) is the one structured-logging surface (§21) — kafkajs's own logger is silenced, not duplicated
      retry: { retries: 3 },
    });
    this.producer = this.kafka.producer();
  }

  async start(): Promise<void> {
    await this.producer.connect();

    const admin = this.kafka.admin();
    await admin.connect();
    const existing = await admin.listTopics();
    const wanted = [...ALL_TOPICS, ...ALL_TOPICS.map((t) => dlqTopic(t))];
    const missing = wanted.filter((t) => !existing.includes(t));
    if (missing.length > 0) {
      await admin.createTopics({
        topics: missing.map((topic) => ({
          topic,
          numPartitions: topic.endsWith(".dlq") ? 3 : 6, // docs/kafka.md's partition table
        })),
      });
      logger.info({ topics: missing }, "Kafka: created missing topics");
    }
    await admin.disconnect();

    this.lagPollTimer = setInterval(
      () => void this.reportConsumerLag().catch((err) => logger.warn({ err: String(err) }, "Failed to report Kafka consumer lag")),
      this.opts.lagPollIntervalMs ?? 15_000,
    );
  }

  async stop(): Promise<void> {
    clearInterval(this.lagPollTimer);
    await this.producer.disconnect();
    await Promise.all(this.consumers.map((c) => c.disconnect()));
  }

  async publish(topic: string, key: string, payload: unknown, eventType: string): Promise<void> {
    const matchId = typeof payload === "object" && payload !== null && "matchId" in payload ? String((payload as { matchId: unknown }).matchId) : key;
    const envelope = buildEnvelope(eventType, matchId, payload);
    await this.producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(envelope) }],
    });
  }

  async subscribe(topic: string, groupId: string, handler: EventHandler): Promise<void> {
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    await consumer.subscribe({ topic, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const envelope = JSON.parse(message.value.toString());
        const key = message.key?.toString() ?? "";
        await handler(envelope, { key });
      },
    });
    this.consumers.push(consumer);
    this.activeSubscriptions.add(`${groupId}::${topic}`);
  }

  /**
   * §21's kafka_consumer_lag — for each (group, topic) this bus actually
   * has a subscriber for, committed offset (fetchOffsets) vs. log-end
   * offset (fetchTopicOffsets' `high` watermark) per partition. A
   * partition with no committed offset yet (offset "-1", e.g. right after
   * a fresh consumer group is created) is skipped rather than reported as
   * an enormous, meaningless lag number.
   */
  private async reportConsumerLag(): Promise<void> {
    const byGroup = new Map<string, string[]>();
    for (const key of this.activeSubscriptions) {
      const [groupId, topic] = key.split("::");
      if (!groupId || !topic) continue;
      const topics = byGroup.get(groupId) ?? [];
      topics.push(topic);
      byGroup.set(groupId, topics);
    }
    if (byGroup.size === 0) return;

    const admin: Admin = this.kafka.admin();
    await admin.connect();
    try {
      const topicHighWatermarks = new Map<string, Map<number, string>>();
      for (const topics of byGroup.values()) {
        for (const topic of topics) {
          if (topicHighWatermarks.has(topic)) continue;
          const offsets = await admin.fetchTopicOffsets(topic);
          topicHighWatermarks.set(topic, new Map(offsets.map((o) => [o.partition, o.high])));
        }
      }

      for (const [groupId, topics] of byGroup) {
        const groupOffsets = await admin.fetchOffsets({ groupId, topics });
        for (const { topic, partitions } of groupOffsets) {
          const highByPartition = topicHighWatermarks.get(topic);
          for (const { partition, offset } of partitions) {
            if (offset === "-1" || !highByPartition) continue; // no committed offset yet
            const high = highByPartition.get(partition);
            if (high === undefined) continue;
            const lag = Number(BigInt(high) - BigInt(offset));
            kafkaConsumerLag.set({ group: groupId, topic, partition: String(partition) }, lag);
          }
        }
      }
    } finally {
      await admin.disconnect();
    }
  }
}
