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

export class QuotaManager {
  constructor(private readonly redis: Redis) {}

  async canPoll(category: PollCategory): Promise<QuotaCheck> {
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
}
