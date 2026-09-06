import type { Redis } from "ioredis";
import { getQuotaState, recordQuota } from "../cache/quotaCache.js";
import { env } from "../config/env.js";
import type { RateLimitInfo } from "../providers/SportsDataProvider.js";

/**
 * docs/adr/ADR-002-polling-strategy.md — enforces the daily budget
 * allocation *by category* (live / fixtures / standings), not just a single
 * global counter, so a burst of standings refreshes can't starve live
 * polling. Also respects the provider's own daily remaining count (from
 * rate-limit headers) as a global safety margin that overrides everything.
 */
export type PollCategory = "live" | "fixtures" | "standings";
export const POLL_CATEGORIES: readonly PollCategory[] = ["live", "fixtures", "standings"];

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
}

function categoryBudget(category: PollCategory): number {
  return { live: env.DAILY_BUDGET_LIVE, fixtures: env.DAILY_BUDGET_FIXTURES, standings: env.DAILY_BUDGET_STANDINGS }[
    category
  ];
}

function spentKey(category: PollCategory, now = new Date()): string {
  return `api:quota:spent:${category}:${now.toISOString().slice(0, 10)}`;
}

function rejectedKey(category: PollCategory): string {
  return `api:quota:rejected:${category}`;
}

export class QuotaManager {
  constructor(private readonly redis: Redis) {}

  async canPoll(category: PollCategory): Promise<QuotaCheck> {
    // A category the provider has already, permanently rejected this
    // request shape for (docs/adr/ADR-002 addendum — e.g. a free-tier plan
    // restriction) must not keep spending budget on doomed requests: §8
    // ("do not waste API requests") applies just as much to a request that
    // will *always* fail as to one blocked by a rate limit.
    if (await this.redis.exists(rejectedKey(category))) {
      return { allowed: false, reason: `category "${category}" previously rejected by provider plan — not retrying today` };
    }

    const state = await getQuotaState(this.redis);
    if (state.dailyRemaining !== undefined && state.dailyRemaining <= env.DAILY_SAFETY_MARGIN) {
      return {
        allowed: false,
        reason: `provider daily quota near exhaustion (${state.dailyRemaining} remaining, safety margin ${env.DAILY_SAFETY_MARGIN})`,
      };
    }

    const spent = Number((await this.redis.get(spentKey(category))) ?? 0);
    const budget = categoryBudget(category);
    if (spent >= budget) {
      return { allowed: false, reason: `category "${category}" daily budget (${budget}) already spent` };
    }
    return { allowed: true };
  }

  /** Call before making the request — tracked even if the request itself later fails. */
  async recordAttempt(category: PollCategory): Promise<void> {
    const key = spentKey(category);
    await this.redis.incr(key);
    await this.redis.expire(key, 60 * 60 * 25);
  }

  async recordResult(rateLimit: RateLimitInfo, outcome: "success" | "failure"): Promise<void> {
    await recordQuota(this.redis, rateLimit, outcome);
  }

  /**
   * Called when a provider rejects a category's query shape permanently
   * (`ProviderQueryRejectedError`) — stops wasting budget on it for the
   * rest of the day. Re-checked daily (TTL, not "forever") since a plan
   * restriction is provider/plan state that could change (e.g. upgrading
   * tiers, or the provider adjusting the restriction) without a deploy.
   */
  async markPermanentlyRejected(category: PollCategory, reason: string): Promise<void> {
    await this.redis.set(rejectedKey(category), reason, "EX", 60 * 60 * 24);
  }

  /** §15's "API Requests Today" — summed across categories, using the same key format `recordAttempt` writes (kept in one place, not duplicated at the read site). */
  async getTotalSpentToday(): Promise<number> {
    const values = await Promise.all(POLL_CATEGORIES.map((category) => this.redis.get(spentKey(category))));
    return values.reduce<number>((sum, v) => sum + Number(v ?? 0), 0);
  }
}
