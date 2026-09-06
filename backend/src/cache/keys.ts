/** Central Redis key schema — docs/adr/ADR-004-redis-strategy.md. Nowhere else should build a Redis key string by hand. */
export const cacheKeys = {
  liveMatch: (matchId: string): string => `live:match:${matchId}`,
  liveMatches: (): string => "live:matches",
  leagueLive: (leagueId: string): string => `league:${leagueId}:live`,
  matchEvents: (matchId: string): string => `match:${matchId}:events`,
  apiQuota: (): string => "api:quota",
  pollLock: (tickId: string): string => `poll:lock:${tickId}`,
};
