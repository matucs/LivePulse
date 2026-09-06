import type { Redis } from "ioredis";
import { cacheKeys } from "./keys.js";
import type { RateLimitInfo } from "../providers/SportsDataProvider.js";

export interface QuotaState extends RateLimitInfo {
  lastSuccessAt?: string;
  lastFailureAt?: string;
}

export async function recordQuota(redis: Redis, info: RateLimitInfo, outcome: "success" | "failure"): Promise<void> {
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
