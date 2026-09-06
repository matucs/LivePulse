/**
 * Real integration test — runs against the actual Postgres + Redis started
 * by `docker compose up` (see docker-compose.yml), no mocks. This is what
 * validates "Ingestion → PostgreSQL → Redis" from docs/architecture.md
 * actually works end to end, not just that the pure mapping/change-
 * detection functions do (test/unit/ covers those).
 *
 * It does NOT call the real API-Football API — no key is configured for
 * this environment. It feeds the same fixture JSON used by the unit tests
 * through `ingestFixture` directly, which is the exact function
 * `pollLiveMatches` calls per real fixture once a provider response comes
 * back mapped. What's NOT proven by this test: that ApiFootballProvider's
 * HTTP call + header parsing works against the real live API. That needs
 * a real API_FOOTBALL_KEY — see README "Known gaps" for how to close it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, withTransaction } from "../../src/db/client.js";
import { redis } from "../../src/cache/redisClient.js";
import { ingestFixture } from "../../src/ingestion/ingestionService.js";
import { mapFixture } from "../../src/providers/mappers/fixtureMapper.js";
import { getMatchById, getMatchEvents, getMatchStatistics } from "../../src/db/repositories/matchRepository.js";
import { getLiveMatchState } from "../../src/cache/liveMatchCache.js";
import { cacheKeys } from "../../src/cache/keys.js";
import fixtureRaw from "../fixtures/fixture-live.json" with { type: "json" };
import eventsRaw from "../fixtures/events.json" with { type: "json" };
import statisticsRaw from "../fixtures/statistics.json" with { type: "json" };
import type { ApiFootballEvent, ApiFootballFixture, ApiFootballStatistics } from "../../src/providers/mappers/apiFootballTypes.js";

const fixture = fixtureRaw as ApiFootballFixture;
const events = eventsRaw as ApiFootballEvent[];
const statistics = statisticsRaw as ApiFootballStatistics[];

async function cleanDatabase(): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("TRUNCATE match_events, match_statistics, standings, matches, seasons, teams, leagues RESTART IDENTITY CASCADE");
  });
}

async function cleanRedis(matchId: string, leagueId: string): Promise<void> {
  await redis.del(cacheKeys.liveMatch(matchId));
  await redis.zrem(cacheKeys.liveMatches(), matchId);
  await redis.srem(cacheKeys.leagueLive(leagueId), matchId);
}

describe("ingestFixture — real Postgres + Redis", () => {
  const mapped = mapFixture(fixture, events, statistics);

  beforeAll(async () => {
    await cleanDatabase();
    await cleanRedis(mapped.match.id, mapped.league.id);
  });

  afterAll(async () => {
    await cleanRedis(mapped.match.id, mapped.league.id);
    await pool.end();
    redis.disconnect();
  });

  it("writes the match, teams, league, season, events and statistics durably to Postgres", async () => {
    const changed = await ingestFixture({ pool, redis }, mapped);
    expect(changed).toBe(true);

    const stored = await getMatchById(pool, mapped.match.id);
    expect(stored).not.toBeNull();
    expect(stored!.homeScore).toBe(2);
    expect(stored!.awayScore).toBe(1);
    expect(stored!.status).toBe("live");

    const storedEvents = await getMatchEvents(pool, mapped.match.id);
    expect(storedEvents).toHaveLength(4);

    const storedStats = await getMatchStatistics(pool, mapped.match.id);
    expect(storedStats).toHaveLength(2);
  });

  it("updates the Redis live-match cache with the current score and a fresh timestamp", async () => {
    const state = await getLiveMatchState(redis, mapped.match.id);
    expect(state).not.toBeNull();
    expect(state!.homeScore).toBe(2);
    expect(state!.status).toBe("live");

    const ageMs = Date.now() - new Date(state!.lastUpdatedAt).getTime();
    expect(ageMs).toBeLessThan(5000);
  });

  it("adds the match to the live-matches and league-live Redis sets", async () => {
    const liveIds = await redis.zrange(cacheKeys.liveMatches(), "0", "-1");
    expect(liveIds).toContain(mapped.match.id);

    const leagueLiveIds = await redis.smembers(cacheKeys.leagueLive(mapped.league.id));
    expect(leagueLiveIds).toContain(mapped.match.id);
  });

  it("re-ingesting the identical polled state is idempotent: no duplicate events, no spurious change", async () => {
    const beforeEvents = await getMatchEvents(pool, mapped.match.id);

    const changed = await ingestFixture({ pool, redis }, mapped);

    const afterEvents = await getMatchEvents(pool, mapped.match.id);
    expect(afterEvents).toHaveLength(beforeEvents.length);
    // isNoOp -> ingestFixture returns false (no real change to report, docs/change-detection.md)
    expect(changed).toBe(false);
  });

  it("a new goal on the next poll produces exactly one new event, not a duplicate set", async () => {
    const nextFixture: ApiFootballFixture = {
      ...fixture,
      fixture: { ...fixture.fixture, status: { long: "Second Half", short: "2H", elapsed: 80 } },
      goals: { home: 3, away: 1 },
    };
    const nextEvents: ApiFootballEvent[] = [
      ...events,
      {
        time: { elapsed: 80, extra: null },
        team: { id: 442, name: "Defensa Y Justicia", logo: "x" },
        player: { id: 5943, name: "New Scorer" },
        assist: { id: null, name: null },
        type: "Goal",
        detail: "Normal Goal",
        comments: null,
      },
    ];
    const nextMapped = mapFixture(nextFixture, nextEvents, statistics);

    const changed = await ingestFixture({ pool, redis }, nextMapped);
    expect(changed).toBe(true);

    const storedEvents = await getMatchEvents(pool, mapped.match.id);
    expect(storedEvents).toHaveLength(5);

    const stored = await getMatchById(pool, mapped.match.id);
    expect(stored!.homeScore).toBe(3);
  });
});
