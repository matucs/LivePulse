import { z } from "zod";
import "dotenv/config";

/**
 * All configuration enters through here and nowhere else. This is also the
 * one place that's allowed to read process.env directly — everything else
 * imports `env` from this module. Fails fast and loudly on startup if
 * required config is missing, rather than surfacing as a confusing runtime
 * error three layers deep.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  SPORTS_PROVIDER: z.literal("api-football").default("api-football"),
  API_FOOTBALL_KEY: z.string().optional(),
  API_FOOTBALL_BASE_URL: z.string().default("https://v3.football.api-sports.io"),

  // docs/adr/ADR-002 addendum + docs/adr/ADR-007 addendum: API-Football's
  // free tier can't supply current-season standings at all, so a second
  // provider supplies standings specifically. Optional — if unset,
  // standings are simply not polled (honestly empty, never faked) rather
  // than falling back to API-Football's known-broken path.
  FOOTBALL_DATA_API_TOKEN: z.string().optional(),
  FOOTBALL_DATA_BASE_URL: z.string().default("https://api.football-data.org/v4"),

  // docs/adr/ADR-003 — real Kafka locally/Production Mode, Redis Streams
  // for the free Portfolio Mode deployment (docs/adr/ADR-008). Same topic/
  // consumer-group design either way (docs/kafka.md); only the transport
  // changes. Optional (undefined driver = events not published — ingestion
  // still writes Postgres/Redis directly, §22 graceful degradation).
  EVENT_BUS_DRIVER: z.enum(["kafka", "redis-streams"]).optional(),
  KAFKA_BROKERS: z
    .string()
    .default("localhost:9092")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),

  // ADR-002 polling tiers, all overridable.
  LIVE_POLL_INTERVAL_MS: z.coerce.number().default(240_000), // 4 min
  PREMATCH_POLL_INTERVAL_MS: z.coerce.number().default(300_000), // 5 min
  UPCOMING_POLL_INTERVAL_MS: z.coerce.number().default(1_800_000), // 30 min

  // ADR-002 daily budget allocation (default matches the ADR's table).
  DAILY_REQUEST_BUDGET: z.coerce.number().default(100),
  DAILY_BUDGET_LIVE: z.coerce.number().default(70),
  DAILY_BUDGET_FIXTURES: z.coerce.number().default(15),
  DAILY_BUDGET_STANDINGS: z.coerce.number().default(10),
  DAILY_SAFETY_MARGIN: z.coerce.number().default(5),

  // Comma-separated API-Football league external IDs LivePulse tracks.
  // Kept small deliberately (§19 Portfolio Mode: "limited number of leagues").
  TRACKED_LEAGUE_IDS: z
    .string()
    .default("39,140,135,78,61,2") // PL, La Liga, Serie A, Ligue 1, Bundesliga, UCL
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof schema>;

function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
