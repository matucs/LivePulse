import type { Redis } from "ioredis";
import type { QueryClient } from "../db/client.js";
import { withTransaction } from "../db/client.js";
import type { SportsDataProvider } from "../providers/SportsDataProvider.js";
import type { MappedFixture, MatchStatus } from "../domain/types.js";
import { ProviderQueryRejectedError } from "../providers/SportsDataProvider.js";
import type { FootballDataProvider } from "../providers/FootballDataProvider.js";
import { deriveSeasonId } from "../providers/mappers/fixtureMapper.js";
import type { EventBus } from "../events/EventBus.js";
import { buildDomainEvents } from "../events/domainEvents.js";
import { detectChanges, synthesizeStatusEvent, type PreviousMatchState } from "./changeDetector.js";
import { QuotaManager, type PollCategory } from "./quotaManager.js";
import { upsertLeague, ensureSeason } from "../db/repositories/leagueRepository.js";
import { upsertTeam, getAllKnownTeams } from "../db/repositories/teamRepository.js";
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
  /**
   * docs/adr/ADR-007 addendum: API-Football's free tier can't supply
   * current-season standings at all (ADR-002 addendum), so this is a
   * distinct, optional, narrower provider used only for that one data
   * type — never a full SportsDataProvider substitute. Undefined means
   * standings are honestly not polled, not silently faked.
   */
  standingsProvider?: FootballDataProvider;
  /**
   * docs/adr/ADR-003 — Phase 4. Optional, same graceful-degradation
   * principle as everywhere else in this file: if unset (or a publish
   * fails), ingestion's Postgres/Redis write already fully succeeded
   * before this is even attempted (see ingestFixture below), so a Kafka
   * outage degrades the product (no downstream fan-out/notifications),
   * it does not break ingestion (§22).
   */
  eventBus?: EventBus;
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
    if (err instanceof ProviderQueryRejectedError) {
      // Known, permanent condition (e.g. a free-tier plan restriction) —
      // not a fault. Logged once per tick at `warn`, not `error`, and never
      // retried (docs/adr/ADR-002 addendum) — an unrelated, working
      // category (e.g. live polling) must keep running regardless.
      logger.warn({ category, reasons: err.reasons }, "Provider rejected this query for this plan — skipping tier");
      await deps.quotaManager.markPermanentlyRejected(category, err.message);
      return { polled: 0, changed: 0, skipped: true, reason: err.message };
    }
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
  seasonYear: number,
  from: Date,
  to: Date,
): Promise<PollResult> {
  return runCategoryPoll(deps, "fixtures", () =>
    deps.provider.getFixturesByLeague(leagueExternalId, seasonYear, from, to),
  );
}

/**
 * Standings come from a *different* provider than matches (ADR-002/007
 * addenda) — API-Football's free tier can't supply current-season
 * standings at all. `deps.standingsProvider` (football-data.org) is
 * resolved by API-Football's own season identity (`seasonId`), never
 * football-data.org's own ids, and its teams are reconciled by name against
 * every team API-Football's match ingestion has ever created
 * (`getAllKnownTeams` — deliberately not scoped to this one league; see its
 * doc comment for why that scoping looked safer but starved the candidate
 * pool in practice) — that's why this needs `deps.pool` ahead of the fetch,
 * not just after it.
 */
export async function pollStandings(
  deps: IngestionDeps,
  leagueExternalId: string,
  seasonYear: number,
): Promise<{ skipped: boolean; reason?: string }> {
  if (!deps.standingsProvider) {
    return { skipped: true, reason: "no standings provider configured (FOOTBALL_DATA_API_TOKEN unset)" };
  }

  const check = await deps.quotaManager.canPoll("standings");
  if (!check.allowed) {
    logger.info({ reason: check.reason }, "Skipping standings poll — quota not available");
    return { skipped: true, reason: check.reason };
  }
  await deps.quotaManager.recordAttempt("standings");

  const seasonId = deriveSeasonId(leagueExternalId, seasonYear);

  let result;
  try {
    const candidates = await getAllKnownTeams(deps.pool);
    result = await deps.standingsProvider.getStandings(leagueExternalId, seasonId, candidates);
  } catch (err) {
    if (err instanceof ProviderQueryRejectedError) {
      logger.warn({ reasons: err.reasons }, "Provider rejected standings query for this plan — skipping tier");
      await deps.quotaManager.markPermanentlyRejected("standings", err.message);
      return { skipped: true, reason: err.message };
    }
    logger.error({ err }, "Standings poll failed");
    return { skipped: true, reason: String(err) };
  }

  await withTransaction(async (client) => {
    // Unreconciled teams (footballDataMapper's doc comment explains why
    // this is the common case, not rare) must exist before the standings
    // rows referencing them — teams.id is a foreign key on standings.
    for (const team of result.newTeams) {
      await upsertTeam(client, team);
    }
    for (const standing of result.standings) {
      await upsertStanding(client, standing);
    }
  });
  return { skipped: false };
}

/**
 * One polled fixture, end to end: read previous state (Redis, then
 * Postgres fallback — cache-aside, ADR-004) → detect what actually changed
 * (docs/change-detection.md) → durable write in one transaction (ADR-005)
 * → update live Redis state → publish domain events (ADR-003, Phase 4).
 * Returns whether anything actually changed.
 *
 * Phase 4 addendum to ADR-003's original design: ingestion still writes
 * Redis directly here (not via a consumer round-trip) — that part of
 * ingestion.md's original "ingestion's job ends at durable write + event
 * published" framing turned out to be a diagram simplification, not
 * literally how the code should work, once real code existed to write
 * against. Kafka's actual job, once built, is decoupling the reactions to
 * a change (WebSocket fan-out, notification decisions — events/consumers/)
 * from ingestion, not re-deriving state ingestion already has correctly
 * and immediately. See docs/adr/ADR-003's Phase 4 addendum.
 */
export async function ingestFixture(
  deps: Pick<IngestionDeps, "pool" | "redis" | "eventBus">,
  mapped: MappedFixture,
): Promise<boolean> {
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

  if (deps.eventBus) {
    const events = buildDomainEvents(mapped, previous, changes, synthetic);
    for (const event of events) {
      try {
        await deps.eventBus.publish(event.topic, event.key, event.payload, event.eventType);
      } catch (err) {
        // docs/ingestion.md's failure table: Postgres + Redis already
        // committed above — a broker outage degrades the event-driven
        // reactions (fan-out, notifications), it must never roll back or
        // block the durable write that already succeeded.
        logger.error({ err, topic: event.topic, matchId: mapped.match.id }, "Failed to publish domain event — durable write already succeeded, continuing");
      }
    }
  }

  return true;
}
