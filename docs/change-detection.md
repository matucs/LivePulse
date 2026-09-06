# Change Detection

This is the component that keeps a 5-minute polling interval from producing
noise: the same provider response, fetched repeatedly, must produce at most
one event per real change — never one event per poll.

## Approach

For every polled match, the mapped domain `Match` (plus its events and
statistics) is compared against the last-known state, read from Redis
`live:match:{id}` first, falling back to PostgreSQL on a cache miss
(same cache-aside pattern as everywhere else, [caching.md](caching.md)).
Comparison is field-by-field, not a whole-object hash — this is what lets
different fields map to different, specific domain events instead of one
generic "something changed" signal.

## Detectors

| Previous → New | Detected as | Kafka topic (ADR-003) |
|---|---|---|
| `homeScore`/`awayScore` differ | `MATCH_SCORE_CHANGED` | `sports.match.score-changed` |
| `status` differs (e.g. `scheduled`→`live`, `live`→`halftime`, `live`→`finished`) | `MATCH_STATUS_CHANGED` | `sports.match.status-changed` |
| New entry in provider's events list not present in last-known events | `MATCH_EVENT_CREATED` (goal / card / substitution / VAR, per event `type`) | `sports.match.event-created` |
| Any field in provider's statistics payload differs from stored `match_statistics` row | `STATISTICS_UPDATED` | `sports.statistics.updated` |
| `status` transitions to `halftime` or `finished` specifically | Also emits a synthetic `MatchEvent` (`halftime`/`fulltime`) in addition to the status-changed event, so the timeline UI has a visible marker | `sports.match.event-created` + `sports.match.status-changed` |

### Example (from §9 of the original spec)

```json
// previous
{ "homeScore": 1, "awayScore": 0 }
// new
{ "homeScore": 2, "awayScore": 0 }
```
→ exactly one `MATCH_SCORE_CHANGED` event, `{ matchId, previousHomeScore: 1, previousAwayScore: 0, homeScore: 2, awayScore: 0 }`. Polling the same new state again five minutes later, unchanged, produces **zero** events — the comparison is always against the last state that *was* different, not against "did I poll since last time."

## Idempotency

Two distinct guarantees, easy to conflate but both necessary:

1. **The detector doesn't emit the same logical change twice** — it compares
   against last-known state before deciding to emit anything, so a poll
   that returns identical data produces no events (the property above).
2. **Even if an event *is* emitted twice** (e.g. ingestion crashes after
   publishing to Kafka but before its own bookkeeping update, and the next
   tick re-detects the same change against stale last-known state), the
   downstream write is still safe, because `MatchEvent` rows are unique on
   `(match_id, sequence_number)` (ADR-005) and consumers upsert rather than
   insert blindly (ADR-003). Change detection minimizes duplicate events;
   idempotent storage is what makes it safe even when detection isn't
   perfect. Relying on only one of these would be fragile — both exist
   because change detection alone can't account for every crash-timing edge
   case, and idempotent storage alone would be wasteful (an event per poll)
   without detection.

## What does *not* count as a change

- `last_polled_at` updates on every tick regardless of detected change — this
  is bookkeeping, not a domain event, and never reaches Kafka.
- Field reordering or cosmetic differences in the provider's raw JSON that
  don't affect any mapped domain field (e.g. the provider changing key
  order) — because comparison happens on the mapped domain model, not on
  raw JSON, this class of noise is filtered out by construction, not by an
  extra deduplication step.
