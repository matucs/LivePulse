import type { Redis } from "ioredis";
import { env } from "../config/env.js";
import { cacheKeys } from "../cache/keys.js";
import { logger } from "../utils/logger.js";
import { pollLiveMatches, pollStandings, pollUpcomingFixtures, type IngestionDeps } from "./ingestionService.js";

/**
 * Tiered polling scheduler — docs/adr/ADR-002-polling-strategy.md. Each
 * tier is its own interval timer; nothing here decides *whether* to spend
 * a request (that's the QuotaManager, per-call) — this only decides *when
 * to try*.
 */
export class PollingScheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly deps: IngestionDeps) {}

  start(): void {
    this.scheduleTier("live", env.LIVE_POLL_INTERVAL_MS, () => pollLiveMatches(this.deps));

    this.scheduleTier("fixtures", env.UPCOMING_POLL_INTERVAL_MS, async () => {
      const from = new Date();
      const to = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // next 3 days
      for (const leagueId of env.TRACKED_LEAGUE_IDS) {
        await pollUpcomingFixtures(this.deps, leagueId, from, to);
      }
    });

    // Standings change rarely intra-day (only when a live match finishes) —
    // a coarser interval than "fixtures" is deliberate (ADR-002 budget table).
    this.scheduleTier("standings", env.UPCOMING_POLL_INTERVAL_MS * 4, async () => {
      const seasonYear = new Date().getFullYear();
      for (const leagueId of env.TRACKED_LEAGUE_IDS) {
        await pollStandings(this.deps, leagueId, seasonYear);
      }
    });

    logger.info(
      { live: env.LIVE_POLL_INTERVAL_MS, fixtures: env.UPCOMING_POLL_INTERVAL_MS },
      "Polling scheduler started",
    );
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private scheduleTier(name: string, intervalMs: number, run: () => Promise<unknown>): void {
    const tick = async () => {
      const acquired = await acquireTickLock(this.deps.redis, name, intervalMs);
      if (!acquired) {
        logger.debug({ tier: name }, "Tick lock held by another instance — skipping");
        return;
      }
      try {
        const result = await run();
        logger.info({ tier: name, result }, "Poll tick complete");
      } catch (err) {
        logger.error({ tier: name, err }, "Poll tick threw unexpectedly");
      }
    };

    this.timers.push(setInterval(tick, intervalMs));
    void tick(); // don't wait a full interval for the first run
  }
}

/**
 * Cross-instance coordination (ADR-002 "Multi-instance coordination"): the
 * tick id is derived from the current time window rounded to the interval,
 * so every instance computes the *same* id for "this tick" and only the
 * first to acquire the Redis lock actually runs it.
 */
async function acquireTickLock(redis: Redis, tierName: string, intervalMs: number): Promise<boolean> {
  const windowId = Math.floor(Date.now() / intervalMs);
  const key = cacheKeys.pollLock(`${tierName}-${windowId}`);
  const result = await redis.set(key, "1", "PX", 5000, "NX");
  return result === "OK";
}
