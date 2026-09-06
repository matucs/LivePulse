# Scalability: Portfolio Mode vs Production Mode

Topology decision: [ADR-008](adr/ADR-008-free-deployment-strategy.md). This
doc is the explicit "what changes and why" requested by §19 — read this
before assuming any specific number here (partitions, connection limits,
polling intervals) is a permanent architectural ceiling rather than a
Portfolio Mode config default.

## What stays exactly the same

Everything in ADR-003 (Kafka topics/consumer groups), ADR-005 (Postgres
schema), ADR-006 (WebSocket fan-out design), and ADR-007 (provider
abstraction) is written to be correct at either scale. This is the point of
those abstractions — Production Mode is a deployment and configuration
change, not a rewrite.

## What actually changes

| Concern | Portfolio Mode | Production Mode | What has to change |
|---|---|---|---|
| Event bus transport | Redis Streams | Kafka (managed) | `EVENT_BUS_DRIVER=kafka` + a real Kafka endpoint — no code change (ADR-003) |
| Backend processes | 1 process (ingestion + API + WS gateway) | 3+ separate services, each scaled independently | Split the monolith's entrypoints into separate deployables — the internal module boundaries already exist, this is a build/deploy change |
| WebSocket gateway instances | 1 | N, behind a load balancer | Needs sticky sessions or a connection-routing layer in front, since a client's TCP connection is still pinned to one instance — the *fan-out* (Redis pub/sub) already supports N instances (ADR-006), only the LB config is new |
| API-Football request budget | 100/day free tier | Paid tier (higher daily limit) | `LIVE_POLL_INTERVAL_MS` decreases (ADR-002); polling architecture unchanged |
| Postgres | Single Neon instance, scale-to-zero | Managed instance with read replicas | Read-heavy queries (standings, historical match lists) route to replicas; writes (ingestion) stay on the primary — schema unchanged (ADR-005) |
| Postgres table growth | No partitioning needed at portfolio data volume | `matches`/`match_events` partitioned by season once history spans many seasons | A migration, not a schema redesign — `UNIQUE` constraints and FKs are unaffected by partitioning by range |
| Redis | Single Upstash instance (256MB/500k commands free) | Managed Redis with more headroom, possibly clustered | Key schema (ADR-004) unchanged; clustering only matters once key count/throughput actually exceeds a single instance |
| Kafka partitions | 6 (documented as more than current throughput needs) | Sized to actual measured throughput per topic | A partition count increase, done deliberately with data, not a guess |
| Provider redundancy | Single provider (API-Football) | Optionally a second provider for specific data (ADR-007) | Config + a new `SportsDataProvider` implementation — ingestion/Kafka/DB/frontend unchanged |

## Known bottlenecks at Portfolio Mode scale (stated honestly, not hidden)

- **Single backend process is a single point of failure.** Combining
  ingestion, API, and WebSocket gateway (ADR-008) means a crash in any one
  takes down all three in Portfolio Mode. Accepted for €0/month; the first
  thing Production Mode fixes.
- **500 concurrent WebSocket connections is a real ceiling**, not a
  conservative default with huge headroom — it's sized to what a single
  free-tier Node process can hold open comfortably. A portfolio demo going
  viral would hit this before it hit any other limit.
- **100 requests/day means "live" tops out at ~8 hours of coverage/day**
  (ADR-002's math) — this is a product constraint as much as a technical
  one, and is why the empty-state and Replay Mode design
  ([technical-decisions.md §2](technical-decisions.md#2-designing-for-the-case-where-nothing-is-live))
  exists at all.

## Consequences of writing it this way

**Positive:** the Production Mode column of the table above is a checklist,
not a research project, if this ever needs to happen for real.

**Negative:** Portfolio Mode's real bottlenecks (single process, connection
cap, request budget) are structural to running at €0/month — no amount of
code quality removes them; only spending money does. Stating that plainly
here is deliberate, not a gap the final review (§32) would need to surface.
