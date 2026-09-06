import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * §21's named metrics, instrumented once here and imported at each real
 * call site — never a separate "fake metrics" layer bolted on top of the
 * pipeline. Uses `prom-client` (not its newer official successor,
 * `@prometheus-io/client`): that package requires Node ^22, which broke at
 * runtime-adjacent risk for a project whose Portfolio Mode deployment
 * (ADR-008) doesn't pin a Node version — `prom-client`, despite carrying a
 * "deprecated, renamed" notice, has zero engine constraints and is what
 * actually works reliably across the Node versions this project might run
 * on. A newer official package name isn't automatically the safer choice.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry }); // process/event-loop metrics — free, standard, not one of §21's named ones but conventional to include

export const providerRequestDuration = new Histogram({
  name: "provider_request_duration_seconds",
  help: "Duration of a request to an external sports data provider",
  labelNames: ["provider", "outcome"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
  registers: [registry],
});

export const providerRequestErrors = new Counter({
  name: "provider_request_errors_total",
  help: "Requests to an external provider that failed",
  labelNames: ["provider", "error_type"], // error_type: "timeout" | "rate_limited" | "plan_rejected" | "other"
  registers: [registry],
});

export const providerQuotaRemaining = new Gauge({
  name: "provider_quota_remaining",
  help: "Remaining request quota, as last reported by the provider",
  labelNames: ["provider", "scope"], // scope: "daily" | "minute"
  registers: [registry],
});

export const eventsDetected = new Counter({
  name: "events_detected_total",
  help: "Domain-event-worthy changes detected by change detection (docs/change-detection.md)",
  labelNames: ["event_type"],
  registers: [registry],
});

export const eventsPublished = new Counter({
  name: "events_published_total",
  help: "Domain events successfully published to the event bus (Kafka/Redis Streams)",
  labelNames: ["topic"],
  registers: [registry],
});

export const eventsProcessed = new Counter({
  name: "events_processed_total",
  help: "Domain events successfully processed by a consumer group",
  labelNames: ["consumer_group", "topic"],
  registers: [registry],
});

export const eventsFailed = new Counter({
  name: "events_failed_total",
  help: "Domain events that exhausted retries and landed in a DLQ topic (§15's 'Failed Events')",
  labelNames: ["consumer_group", "topic"],
  registers: [registry],
});

export const eventProcessingLatency = new Histogram({
  name: "event_processing_latency_seconds",
  help: "Time from a domain event's occurredAt (detection) to a consumer finishing processing it",
  labelNames: ["consumer_group"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 30],
  registers: [registry],
});

export const websocketConnections = new Gauge({
  name: "websocket_connections",
  help: "Currently open WebSocket connections (docs/adr/ADR-006)",
  registers: [registry],
});

export const websocketMessages = new Counter({
  name: "websocket_messages_total",
  help: "WebSocket messages, by direction and type",
  labelNames: ["direction", "type"], // direction: "in" | "out"
  registers: [registry],
});

export const kafkaConsumerLag = new Gauge({
  name: "kafka_consumer_lag",
  help: "Consumer group lag per topic/partition (KafkaEventBus only — Redis Streams has no equivalent concept)",
  labelNames: ["group", "topic", "partition"],
  registers: [registry],
});

export const redisCacheHits = new Counter({
  name: "redis_cache_hits_total",
  help: "Cache-aside reads served from Redis without a Postgres fallback (docs/caching.md)",
  labelNames: ["cache"],
  registers: [registry],
});

export const redisCacheMisses = new Counter({
  name: "redis_cache_misses_total",
  help: "Cache-aside reads that fell back to PostgreSQL",
  labelNames: ["cache"],
  registers: [registry],
});
