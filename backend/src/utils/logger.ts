import pino from "pino";
import { env } from "../config/env.js";

/**
 * Structured logging (§21). Pretty-printed in development, plain JSON in
 * production/test so log aggregation can actually parse it.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
});
