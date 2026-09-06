# Deployment Guide

Topology decisions: [ADR-008](adr/ADR-008-free-deployment-strategy.md).
This doc is the concrete "how to actually stand it up" reference for both
local development and the Portfolio Mode public deployment. Not yet
executed — this is the Phase 2 plan; Phase 3+ implements against it.

## Local development (Docker Compose, §26)

Services: `postgres`, `redis`, `kafka` (KRaft mode, no separate Zookeeper
container needed), `kafka-ui`, `backend`, `frontend`.

```yaml
# docker-compose.yml (planned shape — implemented in Phase 3+)
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: livepulse
      POSTGRES_USER: livepulse
      POSTGRES_PASSWORD: <local-dev-only, set your own>
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7
    ports: ["6379:6379"]

  kafka:
    image: apache/kafka:3.8.0
    ports: ["9092:9092"]
    environment:
      KAFKA_PROCESS_ROLES: broker,controller
      # ... KRaft single-node config

  kafka-ui:
    image: provectuslabs/kafka-ui:latest
    ports: ["8080:8080"]
    depends_on: [kafka]

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgres://livepulse:<password>@postgres:5432/livepulse
      REDIS_URL: redis://redis:6379
      EVENT_BUS_DRIVER: kafka
      KAFKA_BROKERS: kafka:9092
      SPORTS_PROVIDER: api-football
      API_FOOTBALL_KEY: ${API_FOOTBALL_KEY}   # developer-provided, from .env
    ports: ["4000:4000"]
    depends_on: [postgres, redis, kafka]

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:4000
      NEXT_PUBLIC_WS_URL: ws://localhost:4000/ws
    ports: ["3000:3000"]
    depends_on: [backend]

volumes:
  pgdata:
```

`.env.example` (committed; real `.env` never is — enforced by the
pre-commit hook, [technical-decisions.md §3](technical-decisions.md#3-security--credibility-hygiene)):

```bash
API_FOOTBALL_KEY=your-key-here
DATABASE_URL=postgres://livepulse:<password>@localhost:5432/livepulse
REDIS_URL=redis://localhost:6379
EVENT_BUS_DRIVER=kafka
KAFKA_BROKERS=localhost:9092
LIVE_POLL_INTERVAL_MS=240000
```

## Portfolio Mode (public, €0/month)

| Component | Where | Setup |
|---|---|---|
| Frontend | Vercel | Connect repo, set `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL` to the Northflank backend's public URL |
| Backend (API + WS gateway + ingestion) | Northflank free Sandbox | One always-on service from the same backend image used locally, `EVENT_BUS_DRIVER=redis-streams` instead of `kafka` |
| Postgres | Neon free tier | Connection string in `DATABASE_URL`; scale-to-zero is acceptable since the backend itself is always-on and keeps a connection warm |
| Redis | Upstash free tier | `REDIS_URL` (or Upstash's REST/HTTP variant, which works well from environments without persistent TCP) — used both for caching (ADR-004) and as the Redis Streams `EventBus` (ADR-003) |
| Sports data | API-Football | `API_FOOTBALL_KEY`, never exposed to the frontend (§24) |

Environment variables are the only thing that differ from local dev besides
`EVENT_BUS_DRIVER` — same backend image, same schema, same topic/consumer
design (ADR-003), running on a different transport.

## What is explicitly not deployed publicly

- Real Kafka — not available free and always-on (ADR-008); Redis Streams
  substitutes in this environment only.
- Any secrets in the frontend bundle — `API_FOOTBALL_KEY` and database
  credentials live only in the backend's environment, never in
  `NEXT_PUBLIC_*` variables (§24).

## CI/CD (§27)

`.github/workflows/ci.yml` — implemented in Phase 7, three jobs:

- **`backend`**: lint → typecheck → unit tests → real Postgres/Redis
  services → migrations → integration tests → build. Kafka is deliberately
  not a CI service — no current integration test exercises `KafkaEventBus`
  directly (only `RedisStreamsEventBus` has automated coverage); Kafka
  itself was validated manually against real data during Phases 4–6, a
  documented gap, not a silent one.
- **`frontend`**: lint → typecheck → build.
- **`e2e`**: a real Postgres/Redis, real migrations, `scripts/seed-fixture.ts`
  (seeds one real, previously-recorded match — never the live API, so
  automated CI runs never spend the free-tier daily quota, ADR-002) → the
  real built backend, started and health-checked → Playwright against it,
  using the system's Chrome (`channel: "chrome"`, `playwright install
  --with-deps chrome`), not a fresh bundled-Chromium download.

**Honestly stated, not glossed over**: this repository has no GitHub remote
configured, so this workflow has been validated for correctness (YAML
syntax, job structure, and every command individually run against real
local infrastructure — migrations, the seed script, the production build
booting and serving real requests) but has never actually executed as a
real GitHub Actions run. "The YAML is right" and "it's green on GitHub" are
different claims; only the first one is made here.

Deploy-on-merge (Vercel for the frontend, Northflank for the backend) is
still a Phase 9 item, not built in Phase 7 — CI here covers verification,
not deployment.

A real CI badge is added to the README once this workflow exists and is
green — not before (see
[technical-decisions.md §3](technical-decisions.md#3-security--credibility-hygiene)).
