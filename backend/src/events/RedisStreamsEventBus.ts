import { Redis } from "ioredis";
import type { EventBus, EventHandler } from "./EventBus.js";
import { buildEnvelope } from "./EventBus.js";
import { logger } from "../utils/logger.js";

export interface RedisStreamsEventBusOptions {
  redisUrl: string;
}

/**
 * The Portfolio Mode (€0/month) substitute for Kafka (docs/adr/ADR-003 +
 * ADR-008) — no always-on free hosted Kafka exists. Topic names map 1:1 to
 * Redis stream keys; Kafka consumer groups map to Redis consumer groups
 * (`XGROUP`), with real per-group delivery and manual ack (`XACK`), not a
 * fire-and-forget pub/sub imitation. Never described as "Kafka" anywhere
 * user-facing — see technical-decisions.md.
 *
 * Each `subscribe()` opens its own dedicated connection (ioredis
 * recommends this for blocking `XREADGROUP` calls — a shared connection
 * used for a blocking read can't serve any other command meanwhile).
 */
export class RedisStreamsEventBus implements EventBus {
  private readonly publishClient: Redis;
  private readonly subscriberClients: Redis[] = [];
  private stopping = false;

  constructor(private readonly opts: RedisStreamsEventBusOptions) {
    this.publishClient = new Redis(opts.redisUrl);
  }

  async start(): Promise<void> {
    // No topic pre-creation needed — XADD creates the stream on first use,
    // and XGROUP CREATE below uses MKSTREAM for the same reason.
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.publishClient.quit();
    await Promise.all(this.subscriberClients.map((c) => c.quit()));
  }

  async publish(topic: string, key: string, payload: unknown, eventType: string): Promise<void> {
    const matchId = typeof payload === "object" && payload !== null && "matchId" in payload ? String((payload as { matchId: unknown }).matchId) : key;
    const envelope = buildEnvelope(eventType, matchId, payload);
    await this.publishClient.xadd(topic, "*", "key", key, "envelope", JSON.stringify(envelope));
  }

  async subscribe(topic: string, groupId: string, handler: EventHandler): Promise<void> {
    const client = new Redis(this.opts.redisUrl);
    this.subscriberClients.push(client);

    try {
      await client.xgroup("CREATE", topic, groupId, "$", "MKSTREAM");
    } catch (err) {
      if (!String(err).includes("BUSYGROUP")) throw err; // group already exists — expected on every restart after the first
    }

    const consumerName = `${groupId}-${process.pid}`;
    void this.readLoop(client, topic, groupId, consumerName, handler);
  }

  private async readLoop(
    client: Redis,
    topic: string,
    groupId: string,
    consumerName: string,
    handler: EventHandler,
  ): Promise<void> {
    while (!this.stopping) {
      try {
        const result = await client.xreadgroup(
          "GROUP",
          groupId,
          consumerName,
          "COUNT",
          10,
          "BLOCK",
          5000,
          "STREAMS",
          topic,
          ">",
        );
        if (!result) continue; // BLOCK timeout, nothing new — loop and try again

        for (const [, messages] of result as [string, [string, string[]][]][]) {
          for (const [id, fields] of messages) {
            const fieldMap = Object.fromEntries([0, 2].map((i) => [fields[i], fields[i + 1]]));
            const envelope = JSON.parse(fieldMap.envelope ?? "{}");
            try {
              await handler(envelope, { key: fieldMap.key ?? "" });
            } finally {
              // Ack even on handler failure — withDlqHandling (consumerRuntime.ts)
              // already retried and published to DLQ; leaving it unacked would
              // just mean it's redelivered forever on top of that, not instead of it.
              await client.xack(topic, groupId, id);
            }
          }
        }
      } catch (err) {
        if (this.stopping) return;
        logger.error({ topic, groupId, err }, "Redis Streams read loop error — retrying after backoff");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }
}
