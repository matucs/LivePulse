# Technical Decisions Log (ongoing)

This is a running log of decisions that aren't single architecture choices
(those get their own ADR) but shape how the project is built and presented.
Updated as the project progresses, not reconstructed at the end.

## 1. Kafka is a deliberate demonstration choice, not one this workload demands

At API-Football's free-tier budget (100 requests/day) and a realistic number
of concurrently live matches, the actual event volume LivePulse generates is
small — nowhere near what needs Kafka's partitioning, consumer groups, or
replay semantics to stay correct. If this were purely "solve the problem in
front of me," a single-process event emitter, or Postgres `LISTEN/NOTIFY`, or
Redis pub/sub, would be completely sufficient.

Kafka is used anyway, on purpose, to build and demonstrate a real
event-driven pipeline: durable offsets, consumer groups per concern (scores,
stats, alerts), dead-letter handling, and the discipline of decoupling
ingestion from processing. That's a legitimate reason to use it in a
portfolio project — but it's an honest one only if it's stated, not implied.

**What this means in practice:**
- The full topic/consumer-group design is real and it runs (Docker Compose
  locally, and as the documented Production Mode transport — see ADR-003 and
  ADR-008), not a diagram that doesn't correspond to running code.
- The README and case study say directly: this wouldn't be my first choice
  at this scale in a paid job, and here's what I'd use instead if it weren't
  a demonstration project.
- The public €0 deployment does not fake Kafka's presence — it substitutes
  Redis Streams behind the same `EventBus` interface (ADR-008), so a reader
  can't be misled about what's actually running where.

This is the answer to the first question any senior engineer reviewing this
project will ask ("why Kafka for a REST-polling toy?"), stated before they
have to ask it.

## 2. Designing for the case where nothing is live

Real matches aren't running most of the time a reviewer will visit the site.
Combined with a 100-request/day budget, "no live match right now" is the
*common* case, not an edge case, and must not look like the app is broken or
incomplete.

Two concrete product decisions:

- **Home page always has content.** Recently completed matches, upcoming
  fixtures, and standings carry the page whenever nothing is live, so it
  always reads as an intentional, populated product rather than an empty
  shell waiting for a live match.
- **Replay Mode** (planned, Phase 3+): an explicit, clearly-labeled mode that
  replays a real, previously recorded match's actual events and score
  changes on a timer, so the live-update mechanism (WebSocket push, timeline
  animation, stat updates) can be watched on demand — without depending on
  match schedules, and without ever presenting synthetic data as real. The
  label is unambiguous, e.g. "Replaying a real match from March 2026 — not
  live," visually distinct from the LIVE indicator used for actual live
  matches. This is different from the synthetic load-testing tool (§20):
  Replay Mode uses real recorded match data for product demonstration;
  load-testing uses synthetic traffic for engineering stress-testing, and the
  two are never conflated.

## 3. Security & credibility hygiene

- **Secrets:** a local pre-commit hook (`.githooks/pre-commit`) does a
  lightweight regex scan for obvious secret patterns (API keys, private
  keys, connection strings with embedded passwords) before every commit.
  This is a stopgap, not a replacement — once the repo is pushed to GitHub,
  enable GitHub secret scanning + push protection, and swap the local hook
  for `gitleaks` in pre-commit and in CI (Phase 7).
- **Non-commercial framing:** the running app carries a visible footer
  disclaimer (drafted below) so the ToS boundary from ADR-001 is honored in
  the product itself, not just in docs no visitor sees.
- **CI badge:** once GitHub Actions exists (Phase 7), the README gets a real
  build-status badge. Not added before there's a real workflow behind it —
  a badge with nothing running behind it is worse than no badge.

### Draft footer disclaimer copy (for frontend, Phase 3+)

> LivePulse is a non-commercial engineering portfolio project. Match data
> provided by API-Football. Team and competition names and logos are
> trademarks of their respective owners and are used solely for
> identification. Not affiliated with any league, club, or federation.
