import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import type { EventBus, EventHandler } from "./EventBus.js";
import { buildEnvelope } from "./EventBus.js";
import { ALL_TOPICS, dlqTopic } from "./topics.js";
import { logger } from "../utils/logger.js";

export interface KafkaEventBusOptions {
  brokers: string[];
  clientId?: string;
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

  constructor(opts: KafkaEventBusOptions) {
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
  }

  async stop(): Promise<void> {
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
  }
}
