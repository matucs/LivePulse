# WebSocket Reference

Decision and rationale: [ADR-006](adr/ADR-006-websocket-architecture.md).
This doc is the client-facing protocol reference.

## Connecting

`wss://<backend-host>/ws` — no query-string auth token required for the
public, read-only live-data subscription (there's no user data behind it
yet, §29); connection limits (ADR-006) are enforced per-IP and globally
regardless.

## Message reference

### Client → server

| `type` | Fields | Effect |
|---|---|---|
| `subscribe` | `matchId` | Adds this connection to the match's local subscriber set; gateway sends an immediate `match:snapshot`; if this is the first local subscriber for that match, the gateway subscribes to Redis channel `ws:match:{id}` |
| `unsubscribe` | `matchId` | Removes this connection from the match's subscriber set; if it was the last one, the gateway unsubscribes from `ws:match:{id}` |
| `ping` | — | Server replies `pong`; also resets the server's missed-heartbeat counter for this connection |

### Server → client

| `type` | Fields | When |
|---|---|---|
| `match:snapshot` | `matchId`, `data` (full current match + stats) | Immediately after a successful `subscribe` |
| `match:update` | `matchId`, `data` (score/status/elapsed delta) | On `sports.match.score-changed` / `status-changed` reaching the Scores Consumer (ADR-003) |
| `match:event` | `matchId`, `event` (single `MatchEvent`) | On `sports.match.event-created` reaching a consumer |
| `match:stats` | `matchId`, `stats` | On `sports.statistics.updated` reaching the Stats Consumer |
| `error` | `code`, `message` | Subscription limit exceeded, malformed message, or degraded-mode notice (Redis down, ADR-004) |
| `pong` | — | Reply to client `ping` |

## Client reconnect behavior (reference implementation notes)

1. On disconnect, wait with exponential backoff: 1s, 2s, 4s, 8s, 16s, then
   cap at 30s, each ± up to 20% jitter.
2. On reconnect, resend `subscribe` for every `matchId` the client was
   subscribed to before the disconnect — don't assume the gateway (possibly
   a different instance, ADR-006) remembers.
3. Treat the resulting `match:snapshot` as authoritative; discard any
   assumptions about state from before the gap.
4. If `error` with a degraded-mode code is received, fall back to REST
   polling that match's endpoint at a conservative interval (e.g. every
   30s) until a subsequent message indicates recovery.

## Limits (ADR-006 defaults, all configurable)

| Limit | Default |
|---|---|
| Connections per IP | 5 |
| Total concurrent connections (Portfolio Mode) | 500 |
| Subscriptions per connection | 10 |
| Heartbeat interval / missed-pong threshold | 30s / 2 missed |
