# LivePulse — Backend

Ingestion + REST API. Fastify, PostgreSQL (`pg`), Redis (`ioredis`),
TypeScript. No Kafka yet — that's Phase 4
([docs/adr/ADR-003](../docs/adr/ADR-003-kafka-architecture.md)); this
service currently writes to Postgres/Redis directly from the ingestion path
(see the note at the top of `src/ingestion/ingestionService.ts`).

See the [project README](../README.md) for what's actually been verified,
and [docs/architecture.md](../docs/architecture.md) /
[docs/ingestion.md](../docs/ingestion.md) for how this fits together.

## Run it

```bash
docker compose -f ../docker-compose.yml up -d   # Postgres (5433) + Redis (6380)
cp .env.example .env                            # fill in API_FOOTBALL_KEY to enable real polling
npm install
npm run migrate:up -- -m src/db/migrations --migration-file-language sql
npm run dev
```

Without `API_FOOTBALL_KEY` set, the server starts and serves whatever's
already in Postgres, but logs a warning and does not poll — this is
deliberate degraded behavior (§22), not a crash.

## Tests

```bash
npm test                  # unit — pure functions, no services needed
npm run test:integration  # real Postgres + Redis, requires docker compose up
```
