# Final Engineering Review

**Status:** Phase 10, written as if this were a Senior Software Architect
interview conversation about this project — per §32's own instruction, and
in the same spirit as every other addendum in this repo: findings grounded
in what actually happened, not a generic self-assessment checklist. Every
item below cites the real file, real incident, or real log line it comes
from, not a hypothetical.

This review exists because a project that claims no weaknesses is less
credible than one that names them precisely and says what it would do
about each — see [technical-decisions.md](technical-decisions.md) and the
README's "Engineering philosophy" section, which commit to this stance
from the start, not just at the end.

## Architectural weaknesses

- **Portfolio Mode's one-process design (ingestion + API + WebSocket
  gateway in a single Node process, [ADR-008](adr/ADR-008-free-deployment-strategy.md))
  means they share fate.** A crash in the WebSocket gateway's message
  handling takes down live-match ingestion too. Accepted deliberately for
  €0/month; the first thing a real Production Mode migration reverses.
- **Kafka is real in local dev, not in the actual public deployment.** The
  live system at `https://158-180-19-147.nip.io` runs
  `EVENT_BUS_DRIVER=redis-streams` — every Kafka-specific behavior (real
  partition rebalancing, `kafka_consumer_lag`, DLQ topics under real broker
  conditions) has only ever been exercised locally via Docker Compose, not
  against the actual production traffic. The `EventBus` abstraction means
  swapping is a config change, but "designed to be swappable" and "battle
  tested in the environment that matters" are different claims — only the
  first one is true here.
- **Deploy-on-push isn't wired up** ([ADR-008 addendum](adr/ADR-008-free-deployment-strategy.md#addendum-2026-09-09-what-actually-happened-when-this-was-deployed-for-real)) —
  every production update is a manual SSH session, a real regression risk
  (a fix could be forgotten, or applied inconsistently between a
  local-dev-verified state and what's actually running).

## Scalability bottlenecks

- **One Oracle VM, no redundancy.** If it goes down (VM failure, Oracle
  reclaiming Always Free capacity per the addendum above, a kernel panic),
  the entire product is offline until someone notices and intervenes
  manually. No load balancer, no standby instance, no auto-restart above
  the container level (`--restart unless-stopped` recovers a crashed
  *container*, not a dead *VM*).
- **The WebSocket gateway's horizontal-scaling story ([ADR-006](adr/ADR-006-websocket-architecture.md))
  is a design, not a measurement.** Redis pub/sub fan-out was built so N
  gateway instances could each independently subscribe to the same
  channel — but this project has only ever run exactly one instance. The
  claim "this scales horizontally" is architecturally sound and untested
  under real multi-instance load.
- **500 concurrent WebSocket connections is a real, hard ceiling**
  (`WS_MAX_CONNECTIONS`, sized to what one small VM's Node process can hold
  comfortably) — a portfolio demo getting meaningfully popular would hit
  this before any other limit in the system.

## Unnecessary complexity

- **Kafka/EventBus for a ~100-request/day workload** is deliberately more
  machinery than the traffic needs — stated plainly since Phase 2
  ([technical-decisions.md §1](technical-decisions.md#1-kafka-is-a-deliberate-demonstration-choice-not-one-this-workload-demands)),
  not a finding from this review, but worth repeating here: an interviewer
  asking "why Kafka" deserves this answer before they finish the question.
- **Two sports-data providers reconciled by name matching**
  ([ADR-007 addendum](adr/ADR-007-provider-abstraction.md#addendum-2026-09-06-a-second-provider-added--and-why-this-isnt-the-per-field-fallback-this-adr-said-it-wouldnt-build))
  is real, working complexity in service of one feature (standings) that a
  single better-tiered API key would have made unnecessary. Justified here
  because it demonstrates a genuinely hard problem (cross-provider entity
  resolution) that a real multi-vendor product would eventually face
  anyway — but it's disproportionate to what "show the standings table"
  strictly requires.

## Security risks

- **`.env.production` sits as a plaintext file on the VM**, not in a
  secrets manager (Oracle Vault, Doppler, etc.). Fine at this scale, a real
  gap the moment more than one person needs deploy access.
- **`FRONTEND_ORIGIN` briefly ran as `*`** during initial deployment before
  being tightened to the real Vercel origin — a real, if short, window
  where CORS wasn't actually restrictive. Caught and fixed same session,
  but it happened, not just a hypothetical.
- **No rate limiting on the public REST API.** `/api/matches/live` and
  friends only touch Postgres/Redis (the real upstream API-Football quota
  is protected), but nothing stops a scripted client from hammering the
  backend VM's CPU/bandwidth — a real availability risk at zero cost to an
  attacker.
- **No intrusion detection or `fail2ban` on the internet-facing VM** —
  SSH is key-only (no password auth), but there's no active monitoring for
  brute-force attempts or anomalous traffic.
- **The pre-commit secret-scanning hook is still the original regex
  stopgap** ([technical-decisions.md §3](technical-decisions.md#3-security--credibility-hygiene)) —
  now that a real GitHub repo exists, GitHub secret scanning / push
  protection should be verified enabled, not just planned.

## Provider dependency

- **API-Football is a single point of failure for literally all live
  data** — the provider abstraction ([ADR-007](adr/ADR-007-provider-abstraction.md))
  means swapping is a code-level option, but there is no second *live*
  data source actually implemented or on standby. If API-Football's free
  tier terms change again (as its season-scoping restriction already did,
  discovered mid-project — [ADR-002 addendum](adr/ADR-002-polling-strategy.md)),
  the product goes dark until a human responds.
- **football-data.org's own free-tier quota isn't tracked with anywhere
  near the rigor API-Football's is** (no per-category budget, no daily
  reset tracking) — it's currently only used for standings, but that's an
  under-instrumented dependency, not a deliberately de-scoped one.

## API quota problems

- **The 100-request/day budget is shared across every consumer of the same
  key, including accidentally** — this session hit that for real: running
  local dev polling against the same `API_FOOTBALL_KEY` as the freshly
  deployed production backend split the daily budget between two pollers,
  and production's live tier exhausted its category allocation faster than
  ADR-002's math assumed a single poller would
  ([ADR-008 addendum](adr/ADR-008-free-deployment-strategy.md#addendum-2026-09-09-what-actually-happened-when-this-was-deployed-for-real)).
  The system degraded exactly as designed (honest staleness, no crash),
  which is a real point in its favor — but the underlying fragility (no
  environment-level quota isolation) is real too. A production product
  needs separate keys per environment as a hard rule, not a remembered
  convention.

## Data consistency problems

- **Cross-provider team identity is resolved by normalized-name matching**,
  not a stable id — a team whose name is translated or abbreviated
  differently between API-Football and football-data.org (documented
  concretely: "FC Bayern München" vs "Bayern Munich") silently fails to
  reconcile and gets a second, provider-scoped row instead. Accepted and
  logged, not hidden, but it is a real, standing data-quality gap. The
  documented correct fix — a canonical team-identity table with
  per-provider aliases — is a real schema migration, not built.
- **`match_statistics` is a single current-snapshot row per team, not a
  time series** ([ADR-005](adr/ADR-005-postgresql-schema.md)) — no
  "possession over time" or similar trend analysis is possible without a
  schema change.

## Caching problems

- **A silently-stopped ingestion process leaves Redis's live-state cache
  stale without any active eviction** — the system correctly *labels* the
  data as stale (§23) rather than hiding it, which is the right call, but
  there's no active alert when this happens; a human has to notice the UI
  banner or check the ops dashboard.
- **Upstash's free tier (256MB, 500K commands/month) has no usage alerting
  wired in** — nothing here would notice an approaching limit before
  Redis commands start failing.

## WebSocket scalability issues

(See "Scalability bottlenecks" above — the two overlap: single-instance
gateway, untested horizontal scaling, and no graceful-shutdown/connection-
draining behavior on deploy, meaning every manual redeploy hard-drops every
connected client, relying entirely on client-side reconnect logic
([useMatchSocket.ts](../frontend/lib/useMatchSocket.ts)) to recover rather
than a clean handoff.)

## Kafka design issues

- **No schema/version negotiation for the event envelope.** If a future
  change alters a domain event's payload shape, there's no compatibility
  story for messages already sitting in a DLQ topic from before the
  change — they'd need manual inspection to replay correctly.
- **Kafka's actual operational behavior (rebalancing, lag under sustained
  load, DLQ growth) has only been observed in a low-volume local Docker
  Compose environment**, never under production-scale traffic — see
  "Architectural weaknesses" above.

## Database bottlenecks

- **Neon's scale-to-zero assumption depends on the backend staying active
  enough to prevent suspension** ([ADR-008](adr/ADR-008-free-deployment-strategy.md)) —
  if ingestion fully halted for an extended period (e.g. sustained quota
  exhaustion across multiple days), Neon could suspend compute, and the
  next real request would pay a cold-start penalty nothing currently
  measures or alerts on.
- **No connection pooling middleware beyond Neon's own pooler** — fine at
  current write volume; the first thing to revisit if that volume grows
  (already flagged in [scalability.md](scalability.md)).

## Observability gaps

- **Distributed tracing is instrumented but not actually exporting
  anywhere in production.** The real log line from the live deployment:
  `[tracing] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing instrumentation
  loaded but not exporting anywhere.` (`src/observability/tracing.ts`).
  The SDK, instrumentation, and code are real; the actual observable output
  a production incident would need does not exist because no collector was
  ever stood up (a real one — Honeycomb/Grafana Tempo's free tiers, or
  self-hosted Jaeger — costs either money or another free-tier integration
  this project ran out of session time to add).
- **No alerting.** Prometheus-format metrics are real and scraped-ready
  (§21, `src/observability/metrics.ts`), but nothing watches them — if the
  backend crashed at 3am, the only way to find out is to check the site or
  the ops dashboard manually.
- **No log aggregation.** Logs live only in `docker logs` on the one VM,
  lost on container restart unless someone is watching in real time. A
  real product needs these shipped somewhere durable (even a free-tier
  option like Grafana Loud or Axiom) before an incident, not after.

## Deployment limitations

- **Single VM, no blue-green or canary deploys** — every update is
  build-and-restart, with real (if brief) downtime and no automated
  rollback if the new build is broken.
- **No automated VM-level backup or disaster-recovery plan.** Postgres
  (Neon) and Redis (Upstash) have their own vendor-side durability;
  the VM's own configuration (Caddy, Docker, the `.env.production` file)
  exists in exactly one place with no backup.
- **Deploy-on-push not wired** (repeated from "Architectural weaknesses"
  because it's also, concretely, a deployment-process gap): every update
  requires a manual SSH session, which is itself a security surface (the VM
  accepts a specific SSH key with no additional MFA) and a process
  bottleneck (only one person, from one machine, can currently deploy).

## What I would do about each of these, if this became a real product

| Category | Fix |
|---|---|
| One-process design | Split ingestion / API / WebSocket gateway into separate services once traffic justifies it — the module boundaries already exist ([scalability.md](scalability.md)); this is a deploy change, not a rewrite |
| Kafka unvalidated in prod | Either commit to a managed Kafka tier (Confluent Cloud, Upstash Kafka's successor, or self-hosted on a second VM) for Production Mode, or be explicit that Redis Streams *is* the production transport and stop describing Kafka as more than a local-dev/demonstration configuration |
| Deploy-on-push | Finish the Vercel GitHub App authorization (a five-minute dashboard click, not a technical blocker) and add a matching GitHub Actions step that SSHes into the VM, pulls, rebuilds, and restarts on merge to main |
| Single VM / no redundancy | A second VM behind a simple DNS failover (or Oracle's own Always Free allowance split across two instances) before reaching for a full load balancer — cheap insurance before real infrastructure spend |
| WebSocket scaling unverified | A real load test (§20's own synthetic-traffic tool, not yet built) against two gateway instances sharing one Redis, verifying the pub/sub fan-out design under actual concurrent load, not just code review |
| Kafka/EventBus complexity | Keep it — already documented as deliberate — but a real production version of this product would start without it and add it only once multiple independent consumers of the same events actually existed |
| Two-provider reconciliation complexity | A canonical team-identity table with per-provider aliases (the documented correct fix), resolved once, not per-poll name matching forever |
| Plaintext secrets on the VM | Move to a secrets manager (Oracle Vault is free-tier-compatible) the moment more than one person needs deploy access |
| Public API rate limiting | Add a lightweight per-IP rate limiter (`@fastify/rate-limit`) — a same-day fix, genuinely overdue |
| No intrusion detection | `fail2ban` on the VM — a same-day fix |
| Single live-data provider | Identify and implement one real secondary live-data source (even a paid one, at low volume) purely as a documented failover, not for routine use |
| Shared/accidental quota exhaustion | Separate API keys per environment as a hard, enforced rule (a `.env.example` comment isn't enough — this project's own incident proves that) |
| Name-based data reconciliation | The canonical-identity table above; in the meantime, log every unreconciled match prominently enough that it's actually reviewed, not just recorded |
| No time-series statistics | A `match_statistics_history` table, append-only, is a small, well-scoped migration whenever that feature is actually requested |
| Stale-cache with no alerting | A synthetic uptime/freshness check (even a free cron-based one) that pages someone if `dataFreshnessSeconds` for any live match exceeds a threshold for too long |
| No usage alerting on Upstash | Upstash's own dashboard supports usage alerts — turn them on, a five-minute task with no code change |
| No schema versioning for events | Add an explicit `schemaVersion` field to the envelope now, before it's needed — cheap insurance, expensive to retrofit |
| Neon scale-to-zero risk | A scheduled keep-alive ping (or accept the cold-start cost explicitly and measure it, rather than assume it's negligible) |
| No tracing export | Stand up a free-tier OTLP collector (Grafana Cloud's free tier accepts OTLP) — the code is ready, this is purely a "point it somewhere" task |
| No alerting | A free-tier uptime monitor (UptimeRobot, Better Uptime) hitting `/health` as the absolute minimum before anything more sophisticated |
| No log aggregation | Ship container logs to a free-tier aggregator (Axiom, Grafana Loki) rather than relying on `docker logs` surviving |
| No VM backup/DR | Infrastructure-as-code (even a simple shell script capturing the exact `docker run`/Caddy config) checked into the repo, so the VM is reproducible, not a hand-configured snowflake |

## What this review is not

This is not a list padded to look thorough. Every line above traces to a
real file, a real log line, or a real incident from building and deploying
this project — the same discipline the rest of this repository has tried
to hold to throughout (verify before documenting, correct findings rather
than defend original assumptions, and say plainly what's still wrong).
