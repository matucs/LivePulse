import type { FastifyInstance } from "fastify";
import { pool } from "../../db/client.js";
import { getLatestSeasonId, listLeagues } from "../../db/repositories/leagueRepository.js";
import { listStandingsBySeason } from "../../db/repositories/standingsRepository.js";

export async function leagueRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/leagues", async () => {
    const leagues = await listLeagues(pool);
    return { leagues };
  });

  app.get("/api/leagues/:leagueId/standings", async (req, reply) => {
    const { leagueId } = req.params as { leagueId: string };
    const seasonId = await getLatestSeasonId(pool, leagueId);
    if (!seasonId) {
      return reply.code(404).send({ error: "No season found for this league yet — has it been polled?" });
    }
    const standings = await listStandingsBySeason(pool, seasonId);
    return { seasonId, standings };
  });
}
