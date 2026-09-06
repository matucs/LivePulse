import pg from "pg";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

pool.on("error", (err) => {
  // A background error on an idle client must not crash the process
  // (docs/reliability behavior, §22) — logged and left to the pool to
  // recover the connection on next use.
  logger.error({ err }, "Unexpected PostgreSQL pool error");
});

export type QueryClient = Pick<pg.Pool | pg.PoolClient, "query">;

/** Runs `fn` inside a single transaction — see docs/adr/ADR-005 "Transactional boundaries." */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
