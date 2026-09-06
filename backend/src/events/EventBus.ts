import { randomUUID } from "node:crypto";
import type { Topic } from "./topics.js";

/**
 * docs/kafka.md's message envelope — every topic (except DLQ) carries this
 * shape regardless of which EventBus implementation is running underneath.
 */
export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  matchId: string;
  payload: T;
}

export function buildEnvelope<T>(eventType: string, matchId: string, payload: T): EventEnvelope<T> {
  return { eventId: randomUUID(), eventType, occurredAt: new Date().toISOString(), matchId, payload };
}

export interface DlqEnvelope {
  originalTopic: string;
  originalPayload: unknown;
  error: string;
  retryCount: number;
  failedAt: string;
}

export type EventHandler = (envelope: EventEnvelope, raw: { key: string }) => Promise<void>;

/**
 * docs/adr/ADR-003 — the application depends on this, never on kafkajs or
 * ioredis directly. Two implementations: KafkaEventBus (real Kafka, local
 * dev + Production Mode) and RedisStreamsEventBus (the free-tier Portfolio
 * Mode substitute, docs/adr/ADR-008) — selected by `EVENT_BUS_DRIVER`.
 * Deliberately small: publish + subscribe is everything ingestion and the
 * consumers actually need (§10's "why Kafka is useful" doesn't require a
 * bigger surface than this to be true).
 */
export interface EventBus {
  /** `topic` is loosely typed (not just `Topic`) so DLQ topics — topics.ts's `dlqTopic()` — are also valid publish targets. */
  publish(topic: string, key: string, payload: unknown, eventType: string): Promise<void>;
  /**
   * Registers a handler for a consumer group. Delivery is at-least-once
   * (ADR-003): the handler must be idempotent, and its retry/DLQ behavior
   * is provided by `runWithDlq` (events/consumerRuntime.ts), not by
   * individual EventBus implementations — that logic is bus-agnostic.
   */
  subscribe(topic: Topic, groupId: string, handler: EventHandler): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
