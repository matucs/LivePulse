# LivePulse

> Real-Time Sports Intelligence Platform

A continuously running, event-driven sports data platform built on real
football/soccer data — not a simulator, not a tutorial app. LivePulse ingests
live match data from a real external provider, detects meaningful changes,
publishes internal domain events, and pushes real-time updates to the browser
over WebSockets, backed by Postgres (durable history), Redis (live state),
and Kafka (internal event backbone).

This is a portfolio engineering project designed to also be a credible
foundation for a real product, and is documented as such throughout `docs/`.

## Data source

Live match data comes from **[API-Football](https://www.api-football.com/)**.
This is a real, rate-limited external dependency — see
[ADR-001](docs/adr/ADR-001-sports-api-selection.md) for why it was chosen and
[the full provider comparison](docs/research/sports-api-comparison.md) for
what else was evaluated and rejected, and why.

LivePulse is a **non-commercial engineering demo**. It is not a data resale
product, and does not claim rights over the underlying competition data.

## Engineering philosophy

A few decisions worth stating up front rather than leaving implicit (full
detail in [docs/technical-decisions.md](docs/technical-decisions.md)):

- **Kafka is used here on purpose, not because this workload needs it.** At
  API-Football's free-tier budget, real event volume is small enough that a
  single-process emitter or Redis pub/sub would genuinely suffice. Kafka is
  built and run for real (Docker Compose, real topics/consumer groups) to
  demonstrate event-driven architecture deliberately — and this README says
  so, rather than waiting for an interviewer to ask "why Kafka for a
  REST-polling toy?"
- **The empty state is the common case, not an edge case.** Real matches
  aren't live most of the time a visitor arrives. The home page is designed
  to always look intentional (recent results, upcoming fixtures, standings),
  and a clearly-labeled **Replay Mode** (real recorded match data, not
  synthetic) lets anyone watch the live-update mechanics on demand.
- **The engineering ops dashboard is the point, not a bonus.** Consumer lag, event
  latency, quota remaining, WebSocket connections — that's the part that
  demonstrates distributed-systems judgment, not just frontend polish.

## Project status

Built in phases, in order — later phases are not started until earlier ones
are real and working, not simulated.

- [x] **Phase 1 — Research.** Provider comparison, terms/limits review, ADR-001. ✅ Done.
- [x] **Phase 2 — Architecture.** Domain model, Kafka topics, DB schema, caching strategy, WebSocket design, deployment architecture, ADR-002–008. ✅ Done — see [architecture.md](docs/architecture.md).
- [x] **Phase 3 — MVP.** Ingestion → PostgreSQL → Redis → Next.js, no Kafka/WebSockets yet. ✅ Done — real Postgres/Redis via Docker, real REST API, real Next.js UI, all verified running together (see "What's actually verified" below). No Kafka/WebSockets yet, per this phase's own scope.
- [ ] **Phase 4 — Kafka.** Domain events, consumers, topics.
- [ ] **Phase 5 — WebSockets.** Real-time browser updates.
- [ ] **Phase 6 — Observability.** Metrics, logging, tracing.
- [ ] **Phase 7 — Testing.** Unit, integration, E2E.
- [ ] **Phase 8 — AI features.** Match summaries, analysis, Q&A (clearly separated from the core pipeline).
- [ ] **Phase 9 — Deployment.** Portfolio mode, €0/month.
- [ ] **Phase 10 — Case study.** Final write-up + engineering self-review.

## What's actually verified (Phase 3)

Stated plainly, because a claim like "the MVP works" is worth nothing
without saying what was actually checked:

- **29 unit tests** (`backend/test/unit`) cover the provider mapper against
  realistic API-Football fixture JSON, and the change detector's core
  §9 property directly: polling identical state twice produces zero events,
  a real score/status/event/statistics change produces exactly one signal
  each. One of these tests caught a real bug during development — the
  mapper derived `player_id`/`assist_player_id` for events but nothing ever
  inserted the corresponding `players` row, which the schema's foreign key
  correctly rejected. Fixed by deriving minimal player stubs from the
  events themselves (`mapPlayersFromEvents`); see
  `docs/adr/ADR-005-postgresql-schema.md`'s implementation note.
- **5 integration tests** (`backend/test/integration`, `npm run
  test:integration`) run against real Postgres and Redis containers (`docker
  compose up`), not mocks: ingesting a fixture writes durable rows across
  matches/teams/leagues/seasons/events/statistics in one transaction,
  updates the Redis live-state cache and live-match sets correctly, and
  re-ingesting identical state is verified idempotent (no duplicate events).
- **The REST API was hand-verified against that real data**: every route
  (`/api/matches/live`, `/upcoming`, `/recent`, `/matches/:id`, `/events`,
  `/statistics`, `/leagues`, `/leagues/:id/standings`, `/health`,
  `/api/ops/quota`) returns correct, team/player-name-enriched JSON; a
  missing match correctly 404s; starting the server with no
  `API_FOOTBALL_KEY` logs a warning and serves existing data instead of
  crashing (§22).
- **The Next.js frontend was built and screenshotted against that live
  backend** — home page (live/upcoming/recent, correct empty states,
  correct team logos) and match detail page (scoreboard, timeline with
  goals/cards/assists, side-by-side statistics bars) both render real data
  end to end. The staleness banner (ADR-004) was seen firing for real
  during this check, not just unit-tested — the demo data hadn't been
  re-polled in over 5 minutes, and the UI correctly said so instead of
  pretending it was current.

**What is not yet verified**: `ApiFootballProvider`'s actual HTTP calls
against the real, live API-Football endpoint. No API key was available in
this environment. The provider's mapping logic is verified against
realistic fixture JSON matching API-Football's documented v3 response
shape, and the HTTP client's rate-limit-header parsing, retry/backoff, and
circuit breaker are implemented per ADR-002 — but none of that has been
exercised against a real response yet. To close this gap: get a free key at
api-football.com, set `API_FOOTBALL_KEY` in `backend/.env`, and start the
backend — the scheduler will begin polling automatically and the warning
above will stop appearing.

## Documentation map

```text
docs/
  research/              Phase 1 provider research
  adr/                   Architecture Decision Records (ADR-001 – ADR-008, all accepted)
  architecture.md        ✅ system diagram, domain model, end-to-end data flow
  data-provider.md       ✅ SportsDataProvider interface + ApiFootballProvider
  ingestion.md           ✅ polling → change detection → publish pipeline
  change-detection.md    ✅ detectors, idempotency guarantees
  kafka.md               ✅ topics, partitions, consumer groups, DLQ
  websocket.md           ✅ protocol, reconnect, connection limits
  caching.md             ✅ Redis key schema, freshness thresholds, failure modes
  scalability.md         ✅ Portfolio vs Production Mode, honest bottlenecks
  deployment.md          ✅ Docker Compose + Portfolio Mode deploy plan
  reliability.md          (ongoing — expanded through later phases)
  observability.md        (Phase 6)
  ai.md                    (Phase 8)
  technical-decisions.md ✅ ongoing — Kafka honesty, replay mode, security hygiene
```

## Non-goals (for now)

- Not building a fake/simulated match engine as the primary data source. A
  synthetic load-testing tool is a separate, clearly-labeled tool (Phase 6+),
  never presented as real sports data.
- Not implementing every future feature (accounts, notifications,
  multi-sport, multi-provider) up front — the architecture is designed so
  they *can* be added later (see ADR-007), not so they all exist now.

## Getting started

```bash
git config core.hooksPath .githooks     # activates the pre-commit secret scan

docker compose up -d                    # Postgres (5433) + Redis (6380) — see docker-compose.yml
                                         # for why these ports, not the defaults

cd backend
cp .env.example .env                    # fill in API_FOOTBALL_KEY to enable real ingestion
npm install
npm run migrate:up -- -m src/db/migrations --migration-file-language sql
npm run dev                             # http://localhost:4000

cd ../frontend
cp .env.local.example .env.local
npm install
npm run dev                             # http://localhost:3000
```

Running the tests:

```bash
cd backend
npm test                  # 29 unit tests — no services required
npm run test:integration  # 5 integration tests — requires docker compose up
```

The pre-commit hook is a stopgap regex scan for obvious secrets, not a
replacement for real tooling — see
[docs/technical-decisions.md §3](docs/technical-decisions.md#3-security--credibility-hygiene)
for what replaces it once this is pushed to GitHub.
