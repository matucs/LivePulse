import type { Redis } from "ioredis";
import type { QueryClient } from "../db/client.js";
import { getMatchById, getMatchEvents, getMatchStatistics } from "../db/repositories/matchRepository.js";
import { toMatchView, type MatchView } from "./matchView.js";
import { toEventViews, type EventView } from "./eventView.js";

export interface MatchSnapshot {
  match: MatchView;
  events: EventView[];
  statistics: Awaited<ReturnType<typeof getMatchStatistics>>;
}

/**
 * Everything a client needs to render the match-detail page (§3) in one
 * fetch — used by the WebSocket gateway's `match:snapshot` (docs/websocket.md,
 * ADR-006) sent immediately on `subscribe`, so a client never renders a
 * blank page waiting for the first push. Not currently exposed as its own
 * REST endpoint (the existing three routes — /matches/:id, /events,
 * /statistics — already cover the non-WebSocket case); adding one is a
 * one-line wrapper if a future need for it shows up, not built speculatively.
 */
export async function buildMatchSnapshot(pool: QueryClient, redis: Redis, matchId: string): Promise<MatchSnapshot | null> {
  const match = await getMatchById(pool, matchId);
  if (!match) return null;

  const [view, events, statistics] = await Promise.all([
    toMatchView(redis, pool, match),
    getMatchEvents(pool, matchId).then((e) => toEventViews(pool, e)),
    getMatchStatistics(pool, matchId),
  ]);

  return { match: view, events, statistics };
}
