import { Redis } from "ioredis";

const API_BASE_URL = process.env.E2E_API_URL ?? "http://localhost:4000";
const REDIS_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:6380";

export interface MatchSummary {
  id: string;
  status: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

/**
 * These E2E tests exercise the real backend (§25/docs/deployment.md — no
 * mocked API), so a match id has to come from whatever's actually in the
 * database right now, not a hardcoded fixture id. Tries live first, then
 * recent, then upcoming — the same "always show something" fallback order
 * the home page itself uses (docs/technical-decisions.md §2).
 */
export async function getAnyRealMatchId(): Promise<string> {
  for (const path of ["/api/matches/live", "/api/matches/recent", "/api/matches/upcoming"]) {
    const res = await fetch(`${API_BASE_URL}${path}`);
    const { matches } = (await res.json()) as { matches: MatchSummary[] };
    if (matches.length > 0) return matches[0]!.id;
  }
  throw new Error("No real match found in any of live/recent/upcoming — is the backend's database seeded? (docs/deployment.md)");
}

/**
 * Simulates exactly what a Kafka/Streams consumer does after processing a
 * real domain event (scoresConsumer.ts etc., docs/adr/ADR-003's Phase 4
 * addendum) — publishing to the same Redis channel the WebSocket gateway
 * relays from. This is how the "live update, no refresh" E2E test triggers
 * a real update without waiting for an actual goal to happen live.
 */
export async function publishMatchUpdate(matchId: string, payload: Record<string, unknown>): Promise<void> {
  const redis = new Redis(REDIS_URL);
  await redis.publish(
    `ws:match:${matchId}`,
    JSON.stringify({ type: "match:update", matchId, eventType: "MATCH_SCORE_CHANGED", data: payload }),
  );
  await redis.quit();
}
