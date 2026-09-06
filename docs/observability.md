# Observability

Phase 6. This is the doc that turns §21's list into "here's where each one
actually lives in the code, and how it was verified" — not a checklist of
instrumented-sounding names with nothing real behind them.

## Structured logging

`pino` (`src/utils/logger.ts`) — pretty-printed in development, plain JSON
in production so log aggregation can actually parse it. Two things worth
calling out:

- **HTTP request logging was a real gap, closed in Phase 6.** Fastify is
  constructed with `logger: false` (pino is the one structured-logging
  surface, not duplicated) — but that meant, until now, there was zero
  visibility into actual REST traffic: no record of which routes were hit,
  status codes, or response times. An `onResponse` hook now logs
  `{method, path, statusCode, durationMs}` for every request, at `info`
  except `/health` and `/metrics` (scrape/probe traffic, logged at `debug`
  so a monitor's poll interval doesn't flood the log).
- Every ingestion/consumer log line already carried structured context
  (`{matchId, topic, category, ...}`) before this phase — Phase 6 didn't
  need to add that, only the request-level layer above it.

## Metrics

`prom-client` (`src/observability/metrics.ts`), scraped at `GET /metrics`
in standard Prometheus text format. Chose `prom-client` over its newer
official successor, `@prometheus-io/client` — see the file's own comment:
the successor requires Node ^22, which is a real risk for a project whose
Portfolio Mode deployment doesn't pin a Node version; `prom-client`, despite
carrying a "deprecated, renamed" notice, has zero engine constraints and is
what the vast majority of Node services actually run today.

Every §21-named metric, and where it's actually instrumented:

| Metric | Type | Where |
|---|---|---|
| `provider_request_duration_seconds` | Histogram | `ApiFootballProvider`/`FootballDataProvider` request methods — one observation per HTTP attempt (including retries) |
| `provider_request_errors_total` | Counter | Same call sites, classified (`timeout`/`rate_limited`/`plan_rejected`/`http_error`/`other`) in one place per provider (see the "single point of failure-observation" comment in `ApiFootballProvider.ts` — duration/error observation used to risk double-counting until consolidated into one `catch` block) |
| `provider_quota_remaining` | Gauge | `quotaCache.ts`'s `recordQuota` — labeled by provider, so API-Football's and football-data.org's remaining quota are both visible even though only API-Football's gets the full Redis-backed budget-allocation treatment (ADR-002) |
| `events_detected_total` | Counter | `ingestionService.ts`'s `ingestFixture`, right after `buildDomainEvents` — counted independently of whether an event bus is configured, since "detected" and "published" are genuinely different facts |
| `events_published_total` | Counter | Same function, only on a successful `eventBus.publish()` |
| `events_processed_total` | Counter | `consumerRuntime.ts`'s `withDlqHandling` — shared by all four consumers, so this is one instrumentation point, not four |
| `events_failed_total` | Counter | Same wrapper, incremented right before a message is pushed to its `.dlq` topic (§15's "Failed Events") |
| `event_processing_latency_seconds` | Histogram | Same wrapper — measured from the event's own `occurredAt` (set at detection time) to the consumer finishing, the true end-to-end figure |
| `websocket_connections` | Gauge | `WebSocketGateway`'s connect/close handlers |
| `websocket_messages_total` | Counter | Same gateway, both directions — inbound labeled by parsed message type, outbound labeled by a cheap regex extraction on the relayed JSON (not a full parse per fan-out send) |
| `kafka_consumer_lag` | Gauge | `KafkaEventBus`'s own periodic poller (below) — Kafka-only, no Redis Streams equivalent |
| `redis_cache_hits_total` / `redis_cache_misses_total` | Counter | `liveMatchCache.ts`'s `getLiveMatchState` — literally the cache-aside read path docs/caching.md describes |

### `kafka_consumer_lag`, specifically

`KafkaEventBus` tracks exactly which `(groupId, topic)` pairs it has an
active subscriber for (populated by `subscribe()`, not guessed), and every
15s (`lagPollIntervalMs`) asks the Kafka admin API for each topic's
log-end-offset (`fetchTopicOffsets`) and each group's committed offset
(`fetchOffsets`), reporting `lag = high - committed` per partition. A
partition with no committed offset yet (a fresh consumer group) is skipped
rather than reported as a meaningless enormous number. **Verified for
real**: `curl localhost:4000/metrics` while the real pipeline was running
showed genuine per-partition `kafka_consumer_lag{group="...",
topic="...", partition="..."} 0` entries — zero, correctly, because the
consumers were caught up.

### The dashboard's own summary endpoint

`GET /api/ops/summary` computes §15's exact dashboard fields from the same
underlying instruments (never a second, independent calculation that could
drift from what `/metrics` reports): live match count (Redis `ZCARD`), a
Kafka events/sec estimate, max consumer lag, WebSocket connection count,
today's API request spend and remaining quota, Redis hit rate, average
event-processing latency, and failed-event count.

One field needed something Prometheus counters can't give on their own:
**events/sec**. A counter answers "how many, total" — the *rate* is a query
a real Prometheus server computes (`rate()`), which this project doesn't
run (ADR-008: no free hosted Prometheus verified for Portfolio Mode either).
`src/observability/rateWindow.ts`'s `SlidingRateCounter` is the pragmatic
in-process alternative for this one summary field — not a replacement for
the `events_published_total` counter, a companion to it for a context where
no query engine exists to ask.

**Verified for real, not just typechecked**: hitting `/api/ops/summary`
against the actually-running pipeline returned real numbers — 325 live
matches, 48 requests spent today, 5 remaining. The `apiRequestsRemaining: 5`
figure is itself a demonstration of ADR-002's safety margin working
correctly: this session's own extensive real-key testing spent the daily
budget down to exactly the configured safety margin, and polling correctly
stopped itself rather than exhausting the account — visible directly in
this endpoint, not just in a log line.

`events_detected_total`/`redis_cache_hits_total`/`redis_cache_misses_total`
were verified against real Postgres/Redis using the existing fixture data
(no API quota spent) — ingesting a fixture with no prior state produced a
cache miss and exactly the right per-event-type counts (2 score/status
changes, 3 goals, 1 yellow card, 2 stat updates, 1 coarse update); ingesting
the identical state again produced a cache hit and *zero* additional
events — the §9 no-op property, now visible in the metrics themselves, not
just asserted by a unit test.

## Tracing

`@opentelemetry/sdk-node` (`src/observability/tracing.ts`), imported as the
literal first line of `api/server.ts` — instrumentation patches `pg`/`http`
at module load time, so it has to run before anything else imports them.

**A practical minimum, not a full rollout** (§21's own qualifier): HTTP
(Fastify sits on Node's `http` server) and PostgreSQL (`pg`) are
instrumented. Deliberately not the ~150-package
`@opentelemetry/auto-instrumentations-node` meta-package, which bundles
instrumentation for frameworks (Express, GraphQL, MongoDB, ...) this
project doesn't use.

**Redis (`ioredis`) is not instrumented, and this is a finding, not an
oversight.** `@opentelemetry/instrumentation-ioredis` declares support for
ioredis `>=2.0.0 <7` — this project runs 6.0.0, inside that range — but a
minimal isolated test (registering just that instrumentation, issuing real
`SET`/`GET` commands against a real Redis) never emitted a single span,
with no error either. That's a genuine instrumentation/major-version gap,
confirmed by testing rather than assumed from the declared version range.
Shipping it anyway, silently producing zero spans, would be worse than
leaving it out — a future reader would reasonably assume Redis calls were
traced when they weren't. Redis activity is still observable through this
project's own `redis_cache_hits`/`redis_cache_misses` metrics and
indirectly as the timing gap between HTTP and Postgres spans in a trace.

**No free, verified always-on hosted trace backend exists for Portfolio
Mode** (the same honesty standard ADR-008 applies to Kafka) — rather than
default to a `ConsoleSpanExporter` that would drown pino's actual logs in
raw span dumps, tracing exports nowhere until `OTEL_EXPORTER_OTLP_ENDPOINT`
is set (mirrors the `EventBus` pattern exactly: optional infrastructure, a
clear one-line startup message either way, genuinely real the moment it's
configured — never a stub).

**Verified for real**: ran a temporary local Jaeger
(`docker run -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one`), set
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, hit real API routes,
and confirmed real spans in Jaeger's own API — `GET`, `pg-pool.connect`,
`pg.connect`, `pg.query:SELECT ...` (the actual SQL, visible in the span
name). Removed after verification; not part of the default `docker compose
up` (an always-on tracing backend nobody asked to see by default is exactly
the kind of unnecessary footprint this project's Portfolio Mode design
tries to avoid — see the empty-state/Replay-Mode reasoning in
[technical-decisions.md](technical-decisions.md)).

## What this phase deliberately didn't build

- **A hosted Prometheus/Grafana/Jaeger stack running by default.** All
  three are real, verified integrations — `/metrics` is standard Prometheus
  format, tracing is standard OTLP — but none of the actual backends run as
  part of `docker compose up`, matching the same free-tier discipline as
  every other infrastructure decision in this project (ADR-008).
- **Multi-provider Redis-backed quota budgeting.** `provider_quota_remaining`
  is tracked as a Prometheus gauge for both providers, but the Redis-backed
  operational state (`api:quota`, daily-budget allocation, safety margin —
  ADR-002) stays API-Football-specific; broadening that to a real
  multi-provider quota store is a bigger change than this phase's scope,
  and `quotaCache.ts`'s `recordQuota` explicitly guards against a
  football-data.org call accidentally corrupting API-Football's Redis key.
