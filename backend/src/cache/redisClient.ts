import { Redis } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  retryStrategy: (times: number) => Math.min(times * 200, 2000),
});

redis.on("error", (err: Error) => {
  // Redis is required for speed, not correctness (docs/adr/ADR-004) — a
  // connection error is logged and the caller falls back to Postgres,
  // never crashes the process.
  logger.warn({ err: err.message }, "Redis connection error — reads/writes will fall back to PostgreSQL");
});
