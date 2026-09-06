import type { Redis } from "ioredis";
import type { QueryClient } from "../db/client.js";
import { withTransaction } from "../db/client.js";
import type { SportsDataProvider } from "../providers/SportsDataProvider.js";
import type { MappedFixture, MatchStatus } from "../domain/types.js";
import { detectChanges, synthesizeStatusEvent, type PreviousMatchState } from "./changeDetector.js";
import { QuotaManager, type PollCategory } from "./quotaManager.js";
import { upsertLeague, ensureSeason } from "../db/repositories/leagueRepository.js";
import { upsertTeam } from "../db/repositories/teamRepository.js";
import { upsertPlayerStub } from "../db/repositories/playerRepository.js";
import {
  getMatchById,
  getMatchEvents,
  getMatchStatistics,
  insertMatchEvent,
  touchLastPolled,
  upsertMatch,
  upsertMatchStatistics,
} from "../db/repositories/matchRepository.js";
import { upsertStanding } from "../db/repositories/standingsRepository.js";
import { getLiveMatchState, setLiveMatchState, expireLiveMatchState } from "../cache/liveMatchCache.js";
import { cacheKeys } from "../cache/keys.js";
import { logger } from "../utils/logger.js";

export interface IngestionDeps {
  provider: SportsDataProvider;
  pool: QueryClient;
  redis: Redis;
  quotaManager: QuotaManager;
}

export interface PollResult {
  polled: number;
  changed: number;
  skipped: boolean;
  reason?: string;
}

async function runCategoryPoll(
  deps: IngestionDeps,
  category: PollCategory,
  fetch: () => Promise<MappedFixture[]>,
): Promise<PollResult> {
  const check = await deps.quotaManager.canPoll(category);
  if (!check.allowed) {
    logger.info({ category, reason: check.reason }, "Skipping poll tick — quota not available");
    return { polled: 0, changed: 0, skipped: true, reason: check.reason };
  }
  await deps.quotaManager.recordAttempt(category);

  let fixtures: MappedFixture[];
  try {
    fixtures = await fetch();
  } catch (err) {
    logger.error({ category, err }, "Poll tick failed");
    return { polled: 0, changed: 0, skipped: true, reason: String(err) };
  }

  let changed = 0;
  for (const mapped of fixtures) {
    try {
      if (await ingestFixture(deps, mapped)) changed++;
    } catch (err) {
      // One malformed/failed fixture must not abort the whole tick
      // (docs/ingestion.md failure table) — logged, skipped, retried next tick.
      logger.error({ err, matchExternalId: mapped.match.externalId }, "Failed to ingest one fixture — skipping it for this tick");
    }
  }
  return { polled: fixtures.length, changed, skipped: false };
}

/** GET /fixtures?live=all — batched, one request regardless of live match count (ADR-002). */
export function pollLiveMatches(deps: IngestionDeps): Promise<PollResult> {
  return runCategoryPoll(deps, "live", () => deps.provider.getLiveMatches());
}

export function pollUpcomingFixtures(
  deps: IngestionDeps,
  leagueExternalId: string,
  from: Date,
  to: Date,
): Promise<PollResult> {
  return runCategoryPoll(deps, "fixtures", () => deps.provider.getFixturesByLeague(leagueExternalId, from, to));
}

export async function pollStandings(
  deps: IngestionDeps,
  leagueExternalId: string,
  seasonYear: number,
): Promise<{ skipped: boolean; reason?: string }> {
  const check = await deps.quotaManager.canPoll("standings");
  if (!check.allowed) {
    logger.info({ reason: check.reason }, "Skipping standings poll — quota not available");
    return { skipped: true, reason: check.reason };
  }
  await deps.quotaManager.recordAttempt("standings");

  const standings = await deps.provider.getStandings(leagueExternalId, seasonYear);
  await withTransaction(async (client) => {
    for (const standing of standings) {
      await upsertStanding(client, standing);
    }
  });
  return { skipped: false };
}

/**
 * One polled fixture, end to end: read previous state (Redis, then
 * Postgres fallback — cache-aside, ADR-004) → detect what actually changed
 * (docs/change-detection.md) → durable write in one transaction (ADR-005)
 * → update live Redis state. Returns whether anything actually changed.
 *
 * No Kafka publish here yet — Phase 3 is "Real API → Ingestion →
 * PostgreSQL → Redis → Next.js" per the project's own phase gating
 * (README). Domain event publishing is added in Phase 4 (ADR-003) as a
 * step appended here, not a rewrite of this function.
 */
export async function ingestFixture(deps: Pick<IngestionDeps, "pool" | "redis">, mapped: MappedFixture): Promise<boolean> {
  const cached = await getLiveMatchState(deps.redis, mapped.match.id);
  let previous: PreviousMatchState | null = cached;
  if (!previous) {
    const dbMatch = await getMatchById(deps.pool, mapped.match.id);
    previous = dbMatch ? { status: dbMatch.status, homeScore: dbMatch.homeScore, awayScore: dbMatch.awayScore } : null;
  }
  const previousStatus: MatchStatus | null = previous?.status ?? null;

  const [previousEvents, previousStats] = await Promise.all([
    getMatchEvents(deps.pool, mapped.match.id),
    getMatchStatistics(deps.pool, mapped.match.id),
  ]);
  const previousEventSeqs = new Set(previousEvents.map((e) => e.sequenceNumber));

  const changes = detectChanges(previous, mapped, previousEventSeqs, previousStats);
  const synthetic = synthesizeStatusEvent(mapped, previousStatus);

  if (changes.isNoOp && !synthetic) {
    await touchLastPolled(deps.pool, mapped.match.id);
    return false;
  }

  await withTransaction(async (client) => {
    await upsertLeague(client, mapped.league);
    await ensureSeason(client, mapped.season);
    await upsertTeam(client, mapped.homeTeam);
    await upsertTeam(client, mapped.awayTeam);
    await upsertMatch(client, mapped.match);
    // Players referenced by events must exist before match_events is
    // written — its player_id/assist_player_id are foreign keys (ADR-005).
    for (const player of mapped.players) {
      await upsertPlayerStub(client, player);
    }
    for (const event of changes.newEvents) {
      await insertMatchEvent(client, event);
    }
    if (synthetic) {
      await insertMatchEvent(client, synthetic);
    }
    for (const stats of changes.changedStatistics) {
      await upsertMatchStatistics(client, stats);
    }
  });

  await setLiveMatchState(deps.redis, mapped.match.id, {
    status: mapped.match.status,
    homeScore: mapped.match.homeScore,
    awayScore: mapped.match.awayScore,
    elapsedMinutes: mapped.match.elapsedMinutes,
    lastUpdatedAt: new Date().toISOString(),
  });

  if (mapped.match.status === "live" || mapped.match.status === "halftime") {
    await deps.redis.zadd(cacheKeys.liveMatches(), Date.parse(mapped.match.kickoffAt), mapped.match.id);
    await deps.redis.sadd(cacheKeys.leagueLive(mapped.league.id), mapped.match.id);
  } else {
    await deps.redis.zrem(cacheKeys.liveMatches(), mapped.match.id);
    await deps.redis.srem(cacheKeys.leagueLive(mapped.league.id), mapped.match.id);
    if (mapped.match.status === "finished") {
      await expireLiveMatchState(deps.redis, mapped.match.id);
    }
  }

  return true;
}
