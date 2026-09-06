import type { Redis } from "ioredis";
import type { Match } from "../domain/types.js";
import { cacheKeys } from "./keys.js";

/** The subset of Match state that changes fast enough to be worth caching separately (docs/adr/ADR-004). */
export interface LiveMatchState {
  status: Match["status"];
  homeScore: number;
  awayScore: number;
  elapsedMinutes?: number;
  lastUpdatedAt: string; // ISO 8601 — drives dataFreshnessSeconds (docs/caching.md)
}

export async function getLiveMatchState(redis: Redis, matchId: string): Promise<LiveMatchState | null> {
  const raw = await redis.hgetall(cacheKeys.liveMatch(matchId));
  if (!raw || Object.keys(raw).length === 0) return null;
  return {
    status: raw.status as Match["status"],
    homeScore: Number(raw.homeScore),
    awayScore: Number(raw.awayScore),
    elapsedMinutes: raw.elapsedMinutes ? Number(raw.elapsedMinutes) : undefined,
    lastUpdatedAt: raw.lastUpdatedAt!,
  };
}

export async function setLiveMatchState(redis: Redis, matchId: string, state: LiveMatchState): Promise<void> {
  await redis.hset(cacheKeys.liveMatch(matchId), {
    status: state.status,
    homeScore: String(state.homeScore),
    awayScore: String(state.awayScore),
    elapsedMinutes: state.elapsedMinutes !== undefined ? String(state.elapsedMinutes) : "",
    lastUpdatedAt: state.lastUpdatedAt,
  });
}

/** Retention grace period after a match finishes (docs/adr/ADR-004) — not enforced by a blanket TTL on live keys, only on wind-down. */
export async function expireLiveMatchState(redis: Redis, matchId: string, graceSeconds = 3600): Promise<void> {
  await redis.expire(cacheKeys.liveMatch(matchId), graceSeconds);
}

export function computeFreshnessSeconds(lastUpdatedAt: string, now = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - new Date(lastUpdatedAt).getTime()) / 1000));
}
