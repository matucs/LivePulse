import type { Redis } from "ioredis";
import { cacheKeys } from "./keys.js";
import type { RateLimitInfo } from "../providers/SportsDataProvider.js";
import { providerQuotaRemaining } from "../observability/metrics.js";

export interface QuotaState extends RateLimitInfo {
  lastSuccessAt?: string;
  lastFailureAt?: string;
}

export async function recordQuota(
  redis: Redis,
  info: RateLimitInfo,
  outcome: "success" | "failure",
  provider = "api-football",
): Promise<void> {
  // §21's provider_quota_remaining — tracked as a Prometheus gauge for
  // *any* provider, unconditionally.
  if (info.dailyRemaining !== undefined) providerQuotaRemaining.set({ provider, scope: "daily" }, info.dailyRemaining);
  if (info.minuteRemaining !== undefined) providerQuotaRemaining.set({ provider, scope: "minute" }, info.minuteRemaining);

  // The Redis-backed state below (api:quota, read by /api/ops/quota and by
  // QuotaManager's daily-budget-allocation logic, ADR-002) stays
  // API-Football-specific on purpose — broadening it to a real
  // multi-provider quota store (per-provider budgets, safety margins) is a
  // bigger change than this phase's scope. Writing football-data's numbers
  // into the same Redis key would silently corrupt that endpoint, so this
  // guards against it explicitly rather than relying on every caller to
  // remember not to.
  if (provider !== "api-football") return;

  const fields: Record<string, string> = {};
  if (info.dailyLimit !== undefined) fields.dailyLimit = String(info.dailyLimit);
  if (info.dailyRemaining !== undefined) fields.dailyRemaining = String(info.dailyRemaining);
  if (info.minuteLimit !== undefined) fields.minuteLimit = String(info.minuteLimit);
  if (info.minuteRemaining !== undefined) fields.minuteRemaining = String(info.minuteRemaining);
  fields[outcome === "success" ? "lastSuccessAt" : "lastFailureAt"] = new Date().toISOString();

  if (Object.keys(fields).length > 0) {
    await redis.hset(cacheKeys.apiQuota(), fields);
  }
}

export async function getQuotaState(redis: Redis): Promise<QuotaState> {
  const raw = await redis.hgetall(cacheKeys.apiQuota());
  return {
    dailyLimit: raw.dailyLimit ? Number(raw.dailyLimit) : undefined,
    dailyRemaining: raw.dailyRemaining ? Number(raw.dailyRemaining) : undefined,
    minuteLimit: raw.minuteLimit ? Number(raw.minuteLimit) : undefined,
    minuteRemaining: raw.minuteRemaining ? Number(raw.minuteRemaining) : undefined,
    lastSuccessAt: raw.lastSuccessAt,
    lastFailureAt: raw.lastFailureAt,
  };
}
