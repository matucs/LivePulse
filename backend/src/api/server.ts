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
import type { EventBus } from "../events/EventBus.js";
import { KafkaEventBus } from "../events/KafkaEventBus.js";
import { RedisStreamsEventBus } from "../events/RedisStreamsEventBus.js";
import { startScoresConsumer } from "../events/consumers/scoresConsumer.js";
import { startStatsConsumer } from "../events/consumers/statsConsumer.js";
import { startAlertsConsumer } from "../events/consumers/alertsConsumer.js";
import { startNotificationStubConsumer } from "../events/consumers/notificationStubConsumer.js";
import { WebSocketGateway } from "../ws/gateway.js";
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
let eventBus: EventBus | undefined;
let wsGateway: WebSocketGateway | undefined;

/**
 * docs/adr/ADR-003 — same transport-selection pattern as ADR-008 describes:
 * identical topic/consumer-group design either way (docs/kafka.md), only
 * the transport implementation differs. Undefined driver means events are
 * simply not published — ingestion still writes Postgres/Redis directly
 * (§22 graceful degradation), so this is never a hard dependency to start.
 */
async function buildEventBus(): Promise<EventBus | undefined> {
  if (env.EVENT_BUS_DRIVER === "kafka") {
    const bus = new KafkaEventBus({ brokers: env.KAFKA_BROKERS });
    await bus.start();
    return bus;
  }
  if (env.EVENT_BUS_DRIVER === "redis-streams") {
    const bus = new RedisStreamsEventBus({ redisUrl: env.REDIS_URL });
    await bus.start();
    return bus;
  }
  logger.warn(
    "EVENT_BUS_DRIVER not set — Kafka/Streams publishing disabled. Ingestion still writes PostgreSQL/Redis directly; only downstream fan-out and notifications are skipped. Set EVENT_BUS_DRIVER=kafka (local Docker Compose) or redis-streams (Portfolio Mode) to enable it.",
  );
  return undefined;
}

async function start(): Promise<void> {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT }, "LivePulse backend listening");

  // Phase 5, ADR-006 — shares the same HTTP server/port as the REST API
  // (Portfolio Mode's one-process design, ADR-008), upgraded at /ws.
  wsGateway = new WebSocketGateway(app.server, pool, redis, env.REDIS_URL);
  wsGateway.start();

  eventBus = await buildEventBus();
  if (eventBus) {
    // Consumer groups (docs/adr/ADR-003) — independently subscribed, so a
    // slow/failing one can never block another from processing its topic.
    await startScoresConsumer(eventBus, redis);
    await startStatsConsumer(eventBus, redis);
    await startAlertsConsumer(eventBus, redis);
    await startNotificationStubConsumer(eventBus);
  }

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

    const deps: IngestionDeps = { provider, pool, redis, quotaManager, standingsProvider, eventBus };
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
  await eventBus?.stop();
  await wsGateway?.stop();
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
