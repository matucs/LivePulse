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
- [x] **Phase 3 — MVP.** Ingestion → PostgreSQL → Redis → Next.js. ✅ Done and validated against real API-Football + football-data.org keys (see "What's actually verified" below) — not just fixture-based unit tests.
- [x] **Phase 4 — Kafka.** Domain events, consumers, topics. ✅ Done — real Kafka locally (Docker Compose), verified against real match data flowing through all 4 consumer groups; see [ADR-003's Phase 4 addendum](docs/adr/ADR-003-kafka-architecture.md#addendum-2026-09-06-phase-4-what-kafkas-consumers-actually-do-once-real-code-existed).
- [x] **Phase 5 — WebSockets.** Real-time browser updates. ✅ Done — a real goal and several real halftime events flowed automatically end to end (ingestion → Kafka → consumers → Redis pub/sub → gateway → client) with no manual intervention; see [ADR-006's Phase 5 note](docs/adr/ADR-006-websocket-architecture.md#phase-5-implementation-note-verified-against-real-data).
- [ ] **Phase 6 — Observability.** Metrics, logging, tracing.
- [ ] **Phase 7 — Testing.** Unit, integration, E2E.
- [ ] **Phase 8 — AI features.** Match summaries, analysis, Q&A (clearly separated from the core pipeline).
- [ ] **Phase 9 — Deployment.** Portfolio mode, €0/month.
- [ ] **Phase 10 — Case study.** Final write-up + engineering self-review.

## What's actually verified (Phases 3–5)

Stated plainly, because a claim like "the MVP works" is worth nothing
without saying what was actually checked — and because this project found
real bugs and a real free-tier limitation by actually doing this, not by
assuming fixture-based tests were enough.

**Against real API-Football + football-data.org keys, not just fixtures:**
- Live polling works end to end: real matches (confirmed against actual
  fixtures — e.g. Parndorf vs Wolfsberger AC, Enugu Rangers vs AS Sobemap)
  mapped correctly and durably written to Postgres, with correct team
  names/logos/scores served through the REST API.
- **A real free-tier limitation was found, not assumed**: API-Football's
  free plan rejects *every* season-scoped fixture/standings query outright
  (a 2022–2024-only historical window), which Phase 1's research hadn't
  specifically tested. Chasing it down surfaced two independent code bugs
  (the provider client wasn't checking API-Football's `errors` field at
  all, and `withRetry` was silently erasing a non-retryable error's type) —
  both fixed, both covered by new tests. Documented as an
  [ADR-002 addendum](docs/adr/ADR-002-polling-strategy.md#addendum-2026-09-06-free-tier-season-restriction-found-during-real-key-validation).
- **football-data.org was added as a second provider for standings**
  ([ADR-007 addendum](docs/adr/ADR-007-provider-abstraction.md#addendum-2026-09-06-a-second-provider-added--and-why-this-isnt-the-per-field-fallback-this-adr-said-it-wouldnt-build)) —
  the real cross-provider identity problem this raised (its team/league ids
  have no relationship to API-Football's) is solved by name reconciliation
  with an honest fallback (a football-data.org-sourced team row when no
  match exists, not a silently-dropped standings row). Verified: 96 real
  Premier League/La Liga/Serie A/Bundesliga/Ligue 1 standings rows in
  Postgres with correct provider attribution.
- **Kafka works end to end against real data** (Phase 4): a real poll tick
  with 48 real match changes produced 48 `sports.match.updated`, 34
  `sports.match.score-changed`, 28 `sports.match.status-changed`, and 2
  `sports.match.event-created` messages on real Kafka topics (Docker
  Compose), consumed by all 4 consumer groups with verified zero lag — not
  just messages sitting unread. See the
  [ADR-003 Phase 4 addendum](docs/adr/ADR-003-kafka-architecture.md#addendum-2026-09-06-phase-4-what-kafkas-consumers-actually-do-once-real-code-existed)
  for what changed from the original design once real code existed to
  build against, and for the one gap this run surfaced honestly rather
  than hiding (`sports.statistics.updated` never fires yet — live-tier
  polling doesn't fetch per-team stats at all, a pre-existing Phase 3 scope
  gap, not a Phase 4 defect).
- **The WebSocket gateway's central promise was proven with a real goal**
  (Phase 5): while the real ingestion pipeline was running, a client
  subscribed to a batch of live matches received an actual
  `MATCH_SCORE_CHANGED` (1-0 → 2-0) and several real halftime events,
  automatically, through the full chain — ingestion → Kafka →
  `scores`/`alerts` consumers → Redis pub/sub → gateway → client — with no
  manual publish involved. This is §3's "the browser updates without a
  refresh" proven end to end, not just designed. See the
  [ADR-006 Phase 5 note](docs/adr/ADR-006-websocket-architecture.md#phase-5-implementation-note-verified-against-real-data).

**Also verified (fixture-based, no live key needed):**
- **52 unit tests** (`backend/test/unit`) cover provider mapping, change
  detection's core §9 property (an unchanged poll produces zero events),
  the retry/circuit-breaker utility (including the bug above, guarded
  against regressing), cross-provider team-name reconciliation, and the
  Kafka DLQ/retry wrapper (`withDlqHandling`) using fake timers — fast,
  deterministic, no real backoff delays.
- **Integration tests** (`backend/test/integration`, `npm run
  test:integration`) run against real Postgres and Redis containers, not
  mocks — including `websocketGateway.test.ts`: a real `http.Server` +
  gateway + real `ws` clients, covering snapshot delivery, multi-client
  fan-out from one Redis publish, and unsubscribe actually stopping
  delivery.
- **The Next.js frontend now consumes the WebSocket gateway directly** —
  `useMatchSocket` writes straight into the same TanStack Query cache the
  match-detail page already read from, so REST polling is the fallback
  (active only while disconnected), not the primary transport. Verified in
  a real Chrome instance (a throwaway `puppeteer-core` script, not added as
  a project dependency): real snapshot delivery, and the connection-status
  indicator rendering correctly — against both `next dev` (where a
  React-StrictMode double-invoke artifact was chased down and confirmed
  benign, not a real bug) and a production build (`next start`, one clean
  connection, no console warnings). See the
  [ADR-006 frontend integration note](docs/adr/ADR-006-websocket-architecture.md#frontend-integration-note-phase-5-continued-validated-in-a-real-browser).

**What is still not verified**: upcoming fixtures still can't be shown
from either provider (a harder cross-provider *match*-identity problem,
deliberately deferred — see the ADR-002 addendum). WebSocket connection
limits (500 global / 5 per IP) are implemented per ADR-006 but haven't been
load-tested against real concurrent connections yet — that's Phase 6+
territory (§20's synthetic load-testing tool).

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
