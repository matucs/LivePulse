# ADR-002: REST Polling Strategy

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [ADR-001](ADR-001-sports-api-selection.md), [ingestion.md](../ingestion.md), [change-detection.md](../change-detection.md)

## Context

API-Football's free tier allows **100 requests/day, 10/minute** (ADR-001).
Every other design decision about "how live is live" has to fit inside that
budget honestly — no amount of clever code makes 100 requests/day into a
15-second refresh across a full matchday. This ADR does the budget math
explicitly rather than picking a plausible-sounding interval.

## Decision

### The one fact that makes this workable: batched live polling

API-Football's `GET /fixtures?live=all` returns **every currently live match
worldwide in a single request**, regardless of count. Polling cost is
therefore independent of how many matches LivePulse is tracking at once —
one request covers 1 live match or 40. Per-match polling (one request per
live match) would burn the daily quota in minutes on any real matchday and
is explicitly rejected.

### Tiered polling intervals

| Match state | Interval | Rationale |
|---|---|---|
| Upcoming (kickoff > 60 min away) | Every 30 min, via league fixture list (batched per league, not per match) | Only needs to catch postponements/kickoff-time changes; cheap and infrequent |
| Pre-match (kickoff within 60 min) | Every 5 min | Catch late lineup/status changes without spending live-tier budget early |
| **Live** | **Every 3–5 min** (configurable: `LIVE_POLL_INTERVAL_MS`, default 240000) | See budget table below |
| Finished | 0 — polling stops entirely once status is final | No further state can change; re-polling a finished match is pure waste |

### Why 3–5 minutes, not 60 seconds, for live matches

| Live poll interval | Requests/day if polling 8h/day of live coverage | Fits in ~70-request live budget? |
|---|---|---|
| 15s | 1,920 | No — 19x over budget |
| 60s | 480 | No — ~7x over budget |
| 3 min | 160 | No — still over |
| **5 min** | **96** | **Yes, roughly** |

A ~70-request/day budget is reserved for live polling (the remaining ~30 of
the 100-request daily budget covers upcoming/pre-match/standings refresh —
see table below). At 5-minute intervals, that funds **~8 hours of continuous
live-window coverage per day**, which realistically covers an afternoon/
evening slate of matches in the tracked leagues. This is stated in the UI
honestly (§23): LivePulse shows "updated N minutes ago," never claims
sub-minute freshness it can't deliver on the free tier.

**Daily budget allocation (default, configurable):**

| Purpose | Requests/day (budget) |
|---|---|
| Live polling (`fixtures?live=all`) | ~70 |
| Upcoming fixtures refresh (per tracked league, every 30 min during active hours) | ~15 |
| Standings refresh (per tracked league, a few times/day — standings don't change intra-day outside of live matches finishing) | ~10 |
| Safety margin (never spent automatically) | 5 |
| **Total** | **100** |

The Quota Manager (below) enforces this allocation by request *category*,
not just a single global counter, so a burst of standings refreshes can't
starve live polling.

## Quota management

- Every provider response's rate-limit headers
  (`x-ratelimit-requests-limit`, `x-ratelimit-requests-remaining`,
  `X-RateLimit-Limit`, `X-RateLimit-Remaining`) are written to Redis
  `api:quota` (ADR-004) after the call — the system trusts the provider's
  own counters over a locally-reconstructed estimate.
- Before every scheduled call, the scheduler checks `api:quota` against that
  category's remaining allocation. If a category's daily budget is spent,
  that category stops polling for the rest of the day; other categories are
  unaffected.
- If `dailyRemaining` from the provider itself drops below a safety margin
  (default 5), **all** polling stops for the day regardless of category
  budgets — the safety margin exists so a miscalculation never actually
  exhausts the account and locks the demo out entirely.

## Reliability: backoff, retries, circuit breaker

- **Timeouts:** every provider call has a hard timeout (default 8s).
- **Retries:** on network error or 5xx, retry with exponential backoff
  (base 2s, factor 2, max 60s, ±20% jitter), capped at 3 attempts. 429
  responses are never retried immediately — they go straight to the circuit
  breaker path below, since retrying into a rate limit only makes it worse.
- **Circuit breaker:** after 3 consecutive failures (of any kind) for the
  provider, the breaker opens for a cool-down period (default 5 min) —
  during this window, ingestion skips calls entirely and serves last-known
  state from Postgres/Redis with a stale-data indicator (§23), rather than
  hammering a failing or rate-limited provider. The breaker half-opens after
  cool-down (one trial request); a success closes it, a failure re-opens it
  with the same cool-down.

## Multi-instance coordination

Portfolio Mode runs a single ingestion instance, so this matters mainly for
Production Mode (ADR-008/scalability.md), but is built now since it's cheap
and correctness-critical the moment a second instance exists: before
executing a scheduled poll tick, the scheduler attempts
`SET poll:lock:{tickId} NX PX 5000` in Redis. Only the instance that
acquires the lock executes that tick; others skip it. This prevents two
instances from both polling (and both spending quota) for the same tick.

## Consequences

**Positive**
- The 100-request/day constraint is treated as a real engineering constraint
  with a real budget, not hand-waved — this is demonstrable (the ops
  dashboard, §15, shows the actual allocation being spent in real time).
- Batched `live=all` polling means adding more tracked leagues doesn't cost
  more requests, only more filtering logic.

**Negative / accepted constraints**
- Live freshness is genuinely "a few minutes old," not seconds. This is a
  free-tier limitation, documented and shown honestly in the UI rather than
  hidden.
- If a paid API-Football tier were used later, `LIVE_POLL_INTERVAL_MS` is
  the only thing that needs to change to get near-real-time freshness — the
  polling architecture doesn't change, only its configured interval and
  budget table.
