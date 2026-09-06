# Kafka Reference

Decision and rationale: [ADR-003](adr/ADR-003-kafka-architecture.md).
This doc is the operational reference — exact topic configs, message
schemas, and how the local Docker Compose setup (§26) maps to it.

## Topics

| Topic | Partitions | Retention | Key |
|---|---|---|---|
| `sports.match.updated` | 6 | 24h | `matchId` |
| `sports.match.score-changed` | 6 | 7d | `matchId` |
| `sports.match.status-changed` | 6 | 7d | `matchId` |
| `sports.match.event-created` | 6 | 7d | `matchId` |
| `sports.statistics.updated` | 6 | 24h | `matchId` |
| `sports.notification.requested` | 6 | 24h | `matchId` |
| `<topic>.dlq` (one per topic above) | 3 | 14d | same as source topic |

Retention is longer for `score-changed`/`status-changed`/`event-created`
than for the higher-volume, lower-value `statistics.updated`/`match.updated`
streams — a deliberate, stated choice, not a default left unexamined.

## Message envelope

Every message on every topic (except DLQ, see below) shares an envelope:

```json
{
  "eventId": "uuid",
  "eventType": "MATCH_SCORE_CHANGED",
  "occurredAt": "2026-09-06T18:32:10.000Z",
  "matchId": "uuid",
  "payload": { "...": "topic-specific fields, see ADR-003" }
}
```

`eventId` is generated at publish time and is what a future replay/audit
tool would key on; `occurredAt` is when the change was *detected*, not when
the message was produced (they're usually the same tick, but kept distinct
in the schema since ingestion latency is itself a metric worth tracking,
§21).

## DLQ message shape

```json
{
  "originalTopic": "sports.match.score-changed",
  "originalPayload": { "...": "the envelope above" },
  "error": "string message",
  "retryCount": 3,
  "failedAt": "2026-09-06T18:35:00.000Z"
}
```

## Consumer groups

See [ADR-003](adr/ADR-003-kafka-architecture.md#consumer-groups) for the
full table. Group IDs used in code/config:

- `scores-consumer-group`
- `stats-consumer-group`
- `alerts-consumer-group`

Each is independently deployable and independently restartable; offsets are
tracked per group, so restarting one never affects another's position.

## Local Docker Compose (§26)

Local development runs real Kafka (not Redis Streams) via `docker-compose`:
Zookeeper/KRaft broker, Kafka UI (for inspecting topics/DLQs/consumer lag
visually — genuinely useful during development, not just for show), and the
backend configured with `EVENT_BUS_DRIVER=kafka`. Topics are created on
backend startup if they don't exist (idempotent topic creation, matching
the table above) rather than requiring a manual setup step.

## Portfolio Mode substitution

`EVENT_BUS_DRIVER=redis-streams` maps every topic above 1:1 to a Redis
stream key of the same name, consumer groups to `XGROUP`s of the same name,
and DLQ topics to `<topic>.dlq` streams. See
[ADR-003](adr/ADR-003-kafka-architecture.md#eventbus-abstraction-the-honest-part)
for why, and [ADR-008](adr/ADR-008-free-deployment-strategy.md) for when
this is used vs. real Kafka.
