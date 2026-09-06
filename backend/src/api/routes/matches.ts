import type { FastifyInstance } from "fastify";
import { pool } from "../../db/client.js";
import { redis } from "../../cache/redisClient.js";
import {
  getMatchById,
  getMatchEvents,
  getMatchStatistics,
  listLiveMatches,
  listRecentMatches,
  listUpcomingMatches,
} from "../../db/repositories/matchRepository.js";
import { toMatchView, toMatchViews } from "../matchView.js";
import { toEventViews } from "../eventView.js";

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/matches/live", async () => {
    const matches = await listLiveMatches(pool);
    return { matches: await toMatchViews(redis, pool, matches) };
  });

  app.get("/api/matches/upcoming", async () => {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const matches = await listUpcomingMatches(pool, from, to);
    return { matches: await toMatchViews(redis, pool, matches) };
  });

  app.get("/api/matches/recent", async (req) => {
    const { limit } = req.query as { limit?: string };
    const matches = await listRecentMatches(pool, limit ? Number(limit) : 20);
    return { matches: await toMatchViews(redis, pool, matches) };
  });

  app.get("/api/matches/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const match = await getMatchById(pool, id);
    if (!match) {
      return reply.code(404).send({ error: "Match not found" });
    }
    return toMatchView(redis, pool, match);
  });

  app.get("/api/matches/:id/events", async (req) => {
    const { id } = req.params as { id: string };
    const events = await getMatchEvents(pool, id);
    return { events: await toEventViews(pool, events) };
  });

  app.get("/api/matches/:id/statistics", async (req) => {
    const { id } = req.params as { id: string };
    const statistics = await getMatchStatistics(pool, id);
    return { statistics };
  });
}
