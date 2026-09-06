import type { FastifyInstance } from "fastify";
import { redis } from "../../cache/redisClient.js";
import { getQuotaState } from "../../cache/quotaCache.js";

/**
 * Minimal groundwork for the engineering ops dashboard (§15,
 * docs/observability.md — full version is Phase 6). Exposes what's already
 * real and measured today: provider quota state. Consumer lag, event
 * latency, etc. are added here once Kafka exists (Phase 4) — not stubbed
 * out with fake numbers now.
 */
export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/ops/quota", async () => {
    const quota = await getQuotaState(redis);
    return quota;
  });

  app.get("/health", async () => {
    let redisOk = true;
    try {
      await redis.ping();
    } catch {
      redisOk = false;
    }
    return { status: "ok", redis: redisOk };
  });
}
