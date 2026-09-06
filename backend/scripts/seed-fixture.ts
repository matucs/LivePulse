/**
 * Seeds one real, previously-recorded match fixture into Postgres — for
 * local first-run convenience and, more importantly, for CI's E2E job
 * (.github/workflows/ci.yml), which needs *some* real match data to exist
 * without ever touching the actual API-Football quota. Running E2E against
 * a real live API key on every PR would burn through the 100-request/day
 * budget almost immediately (docs/adr/ADR-002) — this sidesteps that
 * entirely by reusing the exact fixture JSON the backend's own unit/
 * integration tests already treat as a legitimate, realistic response
 * shape (test/fixtures/, sourced from API-Football's documented v3 shape).
 *
 * Not a substitute for real-key validation (README's "What's actually
 * verified" section) — this is test/demo data, used only where the goal is
 * "does the UI/pipeline mechanics work," not "is this actually live."
 */
import { pool } from "../src/db/client.js";
import { redis } from "../src/cache/redisClient.js";
import { ingestFixture } from "../src/ingestion/ingestionService.js";
import { mapFixture } from "../src/providers/mappers/fixtureMapper.js";
import fixtureRaw from "../test/fixtures/fixture-live.json" with { type: "json" };
import eventsRaw from "../test/fixtures/events.json" with { type: "json" };
import statisticsRaw from "../test/fixtures/statistics.json" with { type: "json" };
import type { ApiFootballEvent, ApiFootballFixture, ApiFootballStatistics } from "../src/providers/mappers/apiFootballTypes.js";

async function main(): Promise<void> {
  const fixture = fixtureRaw as ApiFootballFixture;
  const events = eventsRaw as ApiFootballEvent[];
  const statistics = statisticsRaw as ApiFootballStatistics[];
  const mapped = mapFixture(fixture, events, statistics);

  await ingestFixture({ pool, redis }, mapped);
  console.log(`Seeded match ${mapped.match.id} (${mapped.homeTeam.name} vs ${mapped.awayTeam.name})`);

  await pool.end();
  redis.disconnect();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
