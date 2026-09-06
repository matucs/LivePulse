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

## Project status

Built in phases, in order — later phases are not started until earlier ones
are real and working, not simulated.

- [x] **Phase 1 — Research.** Provider comparison, terms/limits review, ADR-001. ✅ Done.
- [ ] **Phase 2 — Architecture.** Domain model, Kafka topics, DB schema, caching strategy, WebSocket design, deployment architecture.
- [ ] **Phase 3 — MVP.** Real API → ingestion → PostgreSQL → Redis → Next.js (no Kafka/WebSockets yet).
- [ ] **Phase 4 — Kafka.** Domain events, consumers, topics.
- [ ] **Phase 5 — WebSockets.** Real-time browser updates.
- [ ] **Phase 6 — Observability.** Metrics, logging, tracing.
- [ ] **Phase 7 — Testing.** Unit, integration, E2E.
- [ ] **Phase 8 — AI features.** Match summaries, analysis, Q&A (clearly separated from the core pipeline).
- [ ] **Phase 9 — Deployment.** Portfolio mode, €0/month.
- [ ] **Phase 10 — Case study.** Final write-up + engineering self-review.

## Documentation map

```text
docs/
  research/            Phase 1 provider research
  adr/                 Architecture Decision Records (ADR-001 ...)
  architecture.md      (Phase 2)
  data-provider.md      (Phase 2)
  ingestion.md          (Phase 2/3)
  change-detection.md   (Phase 2/3)
  kafka.md              (Phase 4)
  websocket.md          (Phase 5)
  caching.md            (Phase 2/3)
  scalability.md        (Phase 2, revisited Phase 10)
  reliability.md        (ongoing)
  observability.md      (Phase 6)
  deployment.md         (Phase 9)
  ai.md                 (Phase 8)
  technical-decisions.md (ongoing)
```

## Non-goals (for now)

- Not building a fake/simulated match engine as the primary data source. A
  synthetic load-testing tool is a separate, clearly-labeled tool (Phase 6+),
  never presented as real sports data.
- Not implementing every future feature (accounts, notifications,
  multi-sport, multi-provider) up front — the architecture is designed so
  they *can* be added later (see ADR-007), not so they all exist now.
