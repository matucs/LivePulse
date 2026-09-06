# ADR-004: Redis Strategy

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [caching.md](../caching.md), [ADR-003](ADR-003-kafka-architecture.md), [ADR-006](ADR-006-websocket-architecture.md)

## Context

Redis plays three distinct roles in LivePulse, and conflating them would
make TTL and failure-mode reasoning much harder: fast-changing live state,
a pub/sub fan-out bridge between Kafka consumers and the WebSocket gateway,
and (in Portfolio Mode) the event transport itself via Redis Streams
(ADR-003). This ADR covers the first two; ADR-003 covers the third.

## Decision

### Key schema

| Key | Type | Purpose | TTL |
|---|---|---|---|
| `live:match:{id}` | Hash | Current score, status, elapsed minutes, `lastUpdatedAt` — the fast-path read for a live match | None while live; deleted ~1h after match reaches a final status (grace period for late viewers, then Postgres is authoritative) |
| `live:matches` | Sorted set (score = kickoff timestamp) | IDs of currently-live matches, for the home page "Live Matches" section without a DB hit | Rebuilt each live poll tick; members removed on status→finished |
| `league:{id}:live` | Set | Match IDs currently live in a given league, for "popular leagues" filtering | Same lifecycle as `live:matches` |
| `match:{id}:events` | List (capped, `LTRIM`) | Last ~200 serialized `MatchEvent`s per match, for the timeline fast-path | 24h after match finishes |
| `api:quota` | Hash | `dailyLimit`, `dailyRemaining`, `minuteLimit`, `minuteRemaining`, `lastSuccessAt`, `lastFailureAt` — written from provider rate-limit headers (ADR-002) | None (overwritten continuously; read by the ops dashboard) |
| `poll:lock:{tickId}` | String (`SET NX PX`) | Cross-instance polling coordination (ADR-002) | 5s |
| `ws:match:{id}` | Pub/Sub channel (not a stored key) | Fan-out from Kafka consumers to WebSocket gateway instances (ADR-006) | N/A — transient by nature of pub/sub |

### Cache strategy: cache-aside, not write-through

Reads try Redis first. On a miss (cold key, or Redis was flushed/restarted),
fall back to PostgreSQL, serve that, and repopulate Redis. Writes go to
PostgreSQL synchronously in the ingestion path (ADR-005) and to Redis
opportunistically by the Kafka/Streams consumers (ADR-003) — Postgres never
depends on Redis succeeding.

### Invalidation

There is no explicit invalidation step for `live:match:{id}` — it's kept
correct by every consumer overwriting it on every real change (change
detection, not TTL expiry, is what keeps it fresh; see
[change-detection.md](../change-detection.md)). TTL-based expiry is used
only for lifecycle cleanup (removing keys for matches that finished a while
ago), never as the mechanism that keeps live data current.

### Stale-data behavior (ties to §23)

Every value cached under `live:match:{id}` carries `lastUpdatedAt`. The API
layer computes `dataFreshnessSeconds = now - lastUpdatedAt` on every read and
returns it alongside the data. The frontend renders "Updated N seconds/minutes
ago," and above a configurable threshold (default 90s, tuned to the ~5-minute
live polling interval from ADR-002) switches to an explicit
"⚠ Data may be stale — last successful update: Ns ago" banner. This is a
product requirement, not just a caching footnote: the app must never imply
sub-minute freshness it isn't actually providing.

### Redis failure behavior

Redis is treated as **required for speed, not for correctness**:

- If Redis is unreachable, reads fall back to PostgreSQL directly (slower,
  fully correct) rather than failing the request.
- If Redis is unreachable, the ingestion service still writes to PostgreSQL
  (unaffected) but skips the Redis-state-update and pub/sub-publish steps;
  the WebSocket gateway then has no fan-out signal to push, so connected
  clients stop receiving live pushes and fall back to their own polling
  fallback (ADR-006) until Redis recovers.
- The ops dashboard (§15) surfaces Redis connectivity and cache hit/miss
  rate directly, so this degradation is visible, not silent.

## Consequences

**Positive**
- Clear separation of "Redis as speed" vs "Postgres as correctness" means a
  Redis outage degrades the product (slower, less real-time) rather than
  breaking it.
- A single documented key schema makes the caching layer auditable in one
  place instead of scattered `redis.set()` calls with ad-hoc keys.

**Negative / accepted constraints**
- Cache-aside means a cold start (fresh Redis instance, e.g. after a
  redeploy) briefly hits Postgres harder until keys repopulate. Acceptable
  at portfolio scale; would warrant a warm-up job in Production Mode.
- No Redis Cluster / sharding — a single Upstash Redis instance is the
  Portfolio Mode target (256MB/500k commands per month free tier), which is
  more than sufficient at this scale but is a documented scaling limit (see
  [scalability.md](../scalability.md)).
