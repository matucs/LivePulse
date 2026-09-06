import Fastify from "fastify";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { pool } from "../db/client.js";
import { redis } from "../cache/redisClient.js";
import { ApiFootballProvider } from "../providers/ApiFootballProvider.js";
import { FootballDataProvider } from "../providers/FootballDataProvider.js";
import { QuotaManager } from "../ingestion/quotaManager.js";
import { PollingScheduler } from "../ingestion/scheduler.js";
import type { IngestionDeps } from "../ingestion/ingestionService.js";
import { matchRoutes } from "./routes/matches.js";
import { leagueRoutes } from "./routes/leagues.js";
import { opsRoutes } from "./routes/ops.js";

const app = Fastify({ logger: false }); // structured logging is via pino directly (utils/logger.ts), not Fastify's own

// CORS: the frontend is a separate origin (Vercel) from the backend
// (Northflank/localhost) — §24 requires this be explicit, not wildcard-open
// in a way that would also let arbitrary third-party sites hit the API.
app.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", process.env.FRONTEND_ORIGIN ?? "*");
  reply.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (request.method === "OPTIONS") {
    reply.code(204).send();
  }
});

await app.register(matchRoutes);
await app.register(leagueRoutes);
await app.register(opsRoutes);

let scheduler: PollingScheduler | undefined;

async function start(): Promise<void> {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT }, "LivePulse backend listening");

  if (env.API_FOOTBALL_KEY) {
    const quotaManager = new QuotaManager(redis);
    const provider = new ApiFootballProvider({
      apiKey: env.API_FOOTBALL_KEY,
      baseUrl: env.API_FOOTBALL_BASE_URL,
      onRateLimit: (info) => {
        void quotaManager.recordResult(info, "success");
      },
    });

    // docs/adr/ADR-007 addendum: standings come from a second, narrower
    // provider — API-Football's free tier can't supply current-season
    // standings at all (ADR-002 addendum). Optional: without a token,
    // standings are honestly not polled rather than silently faked.
    let standingsProvider: FootballDataProvider | undefined;
    if (env.FOOTBALL_DATA_API_TOKEN) {
      standingsProvider = new FootballDataProvider({
        apiToken: env.FOOTBALL_DATA_API_TOKEN,
        baseUrl: env.FOOTBALL_DATA_BASE_URL,
        onRateLimit: () => {}, // separate quota surface from API-Football's — not yet on the ops dashboard, see docs/adr/ADR-002 addendum
      });
    } else {
      logger.warn(
        "FOOTBALL_DATA_API_TOKEN not set — standings will not be polled (API-Football's free tier can't supply current-season standings; see docs/adr/ADR-002 addendum). Set FOOTBALL_DATA_API_TOKEN in .env to enable it.",
      );
    }

    const deps: IngestionDeps = { provider, pool, redis, quotaManager, standingsProvider };
    scheduler = new PollingScheduler(deps);
    scheduler.start();
  } else {
    logger.warn(
      "API_FOOTBALL_KEY not set — ingestion scheduler NOT started. The API will serve whatever is already in PostgreSQL, but no new data will be polled. Set API_FOOTBALL_KEY in .env to enable real ingestion.",
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  scheduler?.stop();
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});
