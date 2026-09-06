# ADR-006: WebSocket Architecture

**Status:** Accepted
**Date:** 2026-09-06
**Related:** [websocket.md](../websocket.md), [ADR-004](ADR-004-redis-strategy.md)

## Context

The browser must receive updates without refreshing (§3/§13), from a
gateway that never talks to the external provider directly and that can, in
principle, scale to multiple instances without clients caring which one
they're connected to.

## Decision

### Protocol

Client → server:
```json
{ "type": "subscribe", "matchId": "..." }
{ "type": "unsubscribe", "matchId": "..." }
{ "type": "ping" }
```

Server → client:
```json
{ "type": "match:snapshot", "matchId": "...", "data": { /* current Match + stats */ } }
{ "type": "match:update", "matchId": "...", "data": { "homeScore": 2, "awayScore": 1, "status": "live", "elapsedMinutes": 72 } }
{ "type": "match:event", "matchId": "...", "event": { "type": "goal", "minute": 72, ... } }
{ "type": "match:stats", "matchId": "...", "stats": { ... } }
{ "type": "error", "code": "SUBSCRIBE_LIMIT_EXCEEDED", "message": "..." }
{ "type": "pong" }
```

On `subscribe`, the gateway immediately sends a `match:snapshot` (read
through Redis cache-aside, ADR-004) so the client has correct state even if
no update happens to arrive for a while — clients never render a blank page
waiting for the first push.

### Fan-out design (why the gateway doesn't consume Kafka directly)

The gateway does **not** subscribe to Kafka/Redis Streams topics directly.
Consumers (ADR-003) write state and then `PUBLISH` to a Redis pub/sub
channel `ws:match:{id}`. Each gateway instance subscribes to `ws:match:{id}`
**only while it has at least one local client subscribed to that match**,
and unsubscribes when the last local client for that match disconnects or
unsubscribes.

This matters for one reason: it means gateway instances scale horizontally
without any instance needing to know about any other, and without consumers
needing to know how many gateway instances exist or which clients are
connected where. A client can be on instance A, another on instance B, both
watching the same match — both get the update because both instances
independently subscribe to the same Redis channel.

### Reconnect / disconnect handling

- **Client-side:** exponential backoff on disconnect (1s, 2s, 4s, 8s, 16s,
  capped at 30s, ±20% jitter). On reconnect, the client resubscribes to
  every `matchId` it was previously subscribed to and requests a fresh
  snapshot for each — state is never assumed to have survived the gap.
- **Server-side heartbeat:** ping/pong every 30s; a connection that misses 2
  consecutive pongs is terminated and its subscriptions cleaned up (both
  locally and, if it was the last local subscriber, the Redis channel
  subscription too) — this is what prevents a slow leak of dead connections
  holding open Redis subscriptions.
- **Fallback when Redis is down (ADR-004):** the gateway detects Redis
  pub/sub disconnection and tells connected clients (`error` message,
  degraded flag), and the client falls back to REST polling of the match
  endpoint at a conservative interval until the gateway signals recovery.

### Connection limits

- Per-IP concurrent connection cap (default 5) — prevents a single client
  from opening unbounded sockets.
- Global connection cap (default 500 in Portfolio Mode, configurable) — a
  hard ceiling appropriate to the free-tier host's resources (ADR-008);
  beyond it, new connections receive an `error` and are closed rather than
  degrading service for everyone already connected.
- Per-connection subscription cap (default 10 matches) — a client watching
  10 live matches at once is already a generous ceiling for this product.

### Multiple clients on the same match

Handled naturally by the fan-out design above: N clients subscribed to the
same match on the same gateway instance all receive the same
`ws:match:{id}` pub/sub message; the gateway doesn't fetch or process
per-client, it broadcasts once to its local subscriber set per message.

## Consequences

**Positive**
- Horizontal scalability is a property of the design (Redis pub/sub
  fan-out), not something bolted on later — the same code runs correctly
  whether there's 1 gateway instance (Portfolio Mode) or N (Production
  Mode).
- Snapshot-on-subscribe + resubscribe-on-reconnect means there's no
  "client missed an update while reconnecting" bug class — every reconnect
  starts from a known-correct state, not from replaying missed messages.

**Negative / accepted constraints**
- Redis pub/sub has no delivery guarantee (a message published while no
  instance is subscribed is lost) — acceptable here because the *state*
  (Redis `live:match:{id}`) is always fetched fresh on `subscribe`, so a
  missed pub/sub message only delays a push, it never causes stale data to
  be shown as current.
- A single Node process handling WebSocket connections is a Portfolio Mode
  scaling ceiling (see [scalability.md](../scalability.md)) — Production
  Mode would need a load balancer with sticky sessions or a
  connection-routing layer in front of multiple gateway instances.
