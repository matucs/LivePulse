import type { FastifyInstance } from "fastify";
import { redis } from "../../cache/redisClient.js";
import { getQuotaState } from "../../cache/quotaCache.js";
import { QuotaManager } from "../../ingestion/quotaManager.js";
import { cacheKeys } from "../../cache/keys.js";
import {
  registry,
  eventProcessingLatency,
  eventsFailed,
  redisCacheHits,
  redisCacheMisses,
  websocketConnections,
} from "../../observability/metrics.js";
import { eventsPublishedRate } from "../../observability/rateWindow.js";

/**
 * §15's engineering dashboard, backing endpoints. Two of them, deliberately
 * different shapes for different consumers:
 * - `/metrics` — standard Prometheus text exposition format. Point a real
 *   Prometheus at this in Production Mode; nothing here is Portfolio-Mode-
 *   specific.
 * - `/api/ops/summary` — a friendlier JSON shape for LivePulse's own
 *   frontend dashboard, computed from the same underlying instruments
 *   (docs/observability.md) so the two never drift into disagreement.
 */
export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });

  app.get("/api/ops/quota", async () => {
    const quota = await getQuotaState(redis);
    return quota;
  });

  app.get("/api/ops/summary", async () => {
    const quotaManager = new QuotaManager(redis);
    const [quota, totalSpentToday, liveMatchCount] = await Promise.all([
      getQuotaState(redis),
      quotaManager.getTotalSpentToday(),
      redis.zcard(cacheKeys.liveMatches()),
    ]);

    const hitsMetric = await redisCacheHits.get();
    const missesMetric = await redisCacheMisses.get();
    const hits = sumValues(hitsMetric.values);
    const misses = sumValues(missesMetric.values);
    const total = hits + misses;

    const failedMetric = await eventsFailed.get();
    const failedTotal = sumValues(failedMetric.values);

    const lagMetric = registry.getSingleMetric("kafka_consumer_lag");
    const lagSamples = lagMetric ? (await lagMetric.get()).values : [];
    const maxConsumerLag = lagSamples.reduce((max, v) => Math.max(max, v.value), 0);

    const latencySamples = (await eventProcessingLatency.get()).values;
    const latencySumSeconds = latencySamples.find((v) => v.metricName?.endsWith("_sum"))?.value ?? 0;
    const latencyCount = latencySamples.find((v) => v.metricName?.endsWith("_count"))?.value ?? 0;

    return {
      liveMatches: liveMatchCount,
      kafkaEventsPerSecond: Number(eventsPublishedRate.ratePerSecond().toFixed(2)),
      kafkaConsumerLagMax: maxConsumerLag,
      websocketConnections: (await websocketConnections.get()).values[0]?.value ?? 0,
      apiRequestsToday: totalSpentToday,
      apiRequestsRemaining: quota.dailyRemaining ?? null,
      redisHitRate: total > 0 ? Number((hits / total).toFixed(4)) : null,
      eventProcessingLatencyAvgSeconds: latencyCount > 0 ? Number((latencySumSeconds / latencyCount).toFixed(4)) : null,
      failedEvents: failedTotal,
    };
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

function sumValues(values: Array<{ value: number }>): number {
  return values.reduce((sum, v) => sum + v.value, 0);
}
