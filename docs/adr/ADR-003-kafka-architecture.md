# ADR-003: Kafka Architecture

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [technical-decisions.md §1](../technical-decisions.md#1-kafka-is-a-deliberate-demonstration-choice-not-one-this-workload-demands), [kafka.md](../kafka.md), [ADR-008](ADR-008-free-deployment-strategy.md)

## Context

The data source is a polled REST API, not a stream — so it's fair to ask why
an event bus sits between ingestion and everything downstream at all. Two
separate questions are being answered here, and it's important not to
conflate them:

1. Does *this specific project's* traffic volume require Kafka? **No** — see
   [technical-decisions.md §1](../technical-decisions.md#1-kafka-is-a-deliberate-demonstration-choice-not-one-this-workload-demands).
   At ~100 events/day, a single-process emitter would be functionally
   sufficient.
2. Is the *architectural pattern* — decoupling "detecting a change" from
   "reacting to it" — real and worth building correctly? **Yes**, and that's
   what this ADR designs. The pattern doesn't stop being real just because
   the current traffic is small; it's what lets scores, stats, and
   notifications evolve independently (different retry needs, different
   consumers added later, different failure isolation) without ingestion
   knowing or caring who's listening.

## Decision

### Topics

| Topic | Payload (key fields) | Partition key |
|---|---|---|
| `sports.match.updated` | Coarse "this match changed" signal — full current `Match` snapshot | `matchId` |
| `sports.match.score-changed` | `{ matchId, previousHomeScore, previousAwayScore, homeScore, awayScore, occurredAt }` | `matchId` |
| `sports.match.status-changed` | `{ matchId, previousStatus, newStatus, occurredAt }` | `matchId` |
| `sports.match.event-created` | `{ matchId, eventId, type, minute, teamId, playerId, sequenceNumber, occurredAt }` | `matchId` |
| `sports.statistics.updated` | `{ matchId, teamId, statistics: {...}, occurredAt }` | `matchId` |
| `sports.notification.requested` | `{ matchId, reason, priority, payload }` — produced by the Alerts consumer, not by ingestion directly | `matchId` |

Every topic is keyed by `matchId`. This guarantees per-match ordering within
a partition (a goal and the status change it might trigger arrive in
produced order for consumers of that match) without requiring global
ordering across matches, which nothing needs.

**Partitions:** 6 per topic by default (portfolio scale). This is
deliberately more than current throughput requires, documented as such —
the number that matters is that it's configurable per environment, not that
6 is the "correct" number for 100 events/day.

### Consumer groups

| Consumer group | Subscribes to | Responsibility |
|---|---|---|
| `scores-consumer-group` | `score-changed`, `status-changed` | Update Redis live state + Postgres `Match` row; publish to `ws:match:{id}` pub/sub for the WebSocket gateway |
| `stats-consumer-group` | `statistics.updated` | Update Redis + Postgres `MatchStatistics`; publish to `ws:match:{id}` |
| `alerts-consumer-group` | `event-created`, `status-changed` | Decide which raw events are notification-worthy (goals, red cards, full-time) and produce to `sports.notification.requested` |

Each consumer group is independently scalable and independently restartable.
A slow or crashing stats consumer cannot block score updates from reaching
the browser — this isolation is the actual architectural point being
demonstrated, separate from raw throughput.

### Delivery, retries, dead-letter topics

- **At-least-once delivery.** Consumers commit offsets only after
  successfully processing a message. A crash mid-processing means the
  message is redelivered — handled safely because every consumer's write is
  idempotent (see below).
- **Idempotency, not deduplication-by-luck.** `MatchEvent` rows are unique on
  `(match_id, sequence_number)` (ADR-005); consumers use upsert
  (`ON CONFLICT DO NOTHING` / `DO UPDATE`) rather than blind insert, so
  redelivery is a no-op, not a duplicate.
- **Retries:** a consumer that fails processing a message retries up to 3
  times with backoff (1s, 4s, 16s) before giving up on that message.
- **Dead-letter topics:** `<topic>.dlq`, e.g. `sports.match.score-changed.dlq`.
  A message that exhausts retries is published there with
  `{ originalTopic, originalPayload, error, retryCount, failedAt }` instead
  of blocking the partition. DLQ topics are inspected via Kafka UI locally;
  nothing auto-reprocesses them (a manual/scripted replay tool is a
  reasonable future addition, not built now).

### EventBus abstraction (the honest part)

No always-on free hosted Kafka exists as of 2026 (Upstash Kafka was
discontinued in March 2025; Confluent Cloud's free option is a promotional
credit, not perpetual — see [ADR-001 research](../research/sports-api-comparison.md)).
Rather than skip the event-driven design for the public deployment, or
falsely claim Kafka runs there, the application depends on an `EventBus`
interface:

```typescript
interface EventBus {
  publish(topic: string, key: string, payload: unknown): Promise<void>;
  subscribe(topic: string, groupId: string, handler: (msg: EventMessage) => Promise<void>): void;
}
```

Two implementations:
- **`KafkaEventBus`** (kafkajs) — real Kafka, via Docker Compose locally and
  as the documented Production Mode transport (ADR-008).
- **`RedisStreamsEventBus`** (ioredis, `XADD`/`XREADGROUP`/`XACK`) — used in
  the free public deployment where Kafka can't run continuously for €0.
  Topic names map 1:1 to Redis stream keys; Kafka consumer groups map to
  Redis consumer groups (`XGROUP CREATE`). This is a real substitute with
  real consumer-group semantics (each message delivered to one consumer per
  group, manual ack, pending-entry redelivery) — not a mock.

Selected via `EVENT_BUS_DRIVER=kafka|redis-streams`. The topic/consumer-group
design above is identical either way; only the transport changes.

## Consequences

**Positive**
- Score, stats, and alert processing fail independently — a real property,
  demonstrable by killing one consumer and showing the others keep working.
- The DLQ + idempotent upsert design means "the same match polled twice"
  never produces duplicate history, which is the actual hard part of this
  kind of pipeline (see [change-detection.md](../change-detection.md)).
- The EventBus abstraction means the Kafka topic/partition/consumer-group
  design isn't vaporware that only exists in a diagram — it runs, in both
  deployment modes, just on different transports.

**Negative / accepted constraints**
- Running Kafka (even locally) is genuine operational overhead for a
  100-event/day workload. This is accepted and stated plainly (§1 of
  technical-decisions.md) as the cost of demonstrating the pattern.
- Redis Streams is not Kafka — no true partitioning across brokers, weaker
  durability guarantees, no cross-datacenter replication story. It is
  sufficient for portfolio-scale throughput and is documented as a
  Portfolio Mode-only substitution, never described as "Kafka" in anything
  user-facing.

## Addendum (2026-09-06, Phase 4): what Kafka's consumers actually do, once real code existed

The original design above (and docs/ingestion.md, written in Phase 2)
described ingestion's job as ending at "durable write + event published,"
with Redis live-state updates happening downstream in the consumers. Once
Phase 4 actually built the consumers, that framing turned out to be a
diagram-level simplification rather than the right implementation:

- `ingestFixture` (ingestionService.ts) still writes Redis directly,
  synchronously, in the same call that writes Postgres — unchanged from
  Phase 3. Moving that to a consumer would mean the fast, cache-aside read
  path (ADR-004) is *only* correct after a Kafka round-trip completes,
  which is strictly worse (an extra failure mode and an extra hop of
  latency) for something ingestion can already do correctly and immediately
  after mapping the provider's response.
- What the consumers actually do, once built: **`scores-consumer-group`**
  and **`stats-consumer-group`** publish to the Redis pub/sub channel
  `ws:match:{id}` (`cache.keys.wsMatchChannel`) — the fan-out signal the
  Phase 5 WebSocket gateway will subscribe to (ADR-006). **`alerts-
  consumer-group`** does two things with `sports.match.event-created`: the
  same `ws:match:{id}` fan-out (`match:event`, for the live timeline —
  the original design didn't assign anyone this job, a real gap closed
  here rather than adding a fourth consumer group for one topic) and
  deciding notification-worthiness, producing to
  `sports.notification.requested` as designed. A **stub consumer**
  completes the loop by actually consuming that topic (logging only) —
  proving the seam is real and consumable, not just declared.
- This is still exactly the property §10 and this ADR's introduction claim:
  scores, stats, and alerts processing are independent, and Kafka decouples
  "detecting a change" from "reacting to it." What changed is *which*
  reactions live in the consumers — the WebSocket fan-out and notification
  decision, not a redundant re-derivation of state ingestion already has.

Verified against real data (not synthetic): a live poll tick with 48 real
match changes produced 48 `sports.match.updated`, 34
`sports.match.score-changed`, 28 `sports.match.status-changed`, and 2
`sports.match.event-created` messages; `alerts-consumer-group`'s consumer
lag was 0 on both real events, confirming actual consumption, not just
messages accumulating unread. `sports.statistics.updated` stayed at 0
messages in this run — expected, not a bug: `/fixtures?live=all` (the
batched live-polling endpoint, ADR-002) doesn't include per-team
statistics in its response at all, only `getMatch()`'s single-fixture path
does, and nothing currently calls that on a recurring cadence for live
matches. This is a pre-existing ingestion-scope gap from Phase 3, not one
introduced by or in scope for Phase 4's event bus work — noted here rather
than silently left unexplained by an event topic that never fires.
