import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    // Real Postgres/Redis + full-tick ingestion can take a bit longer than
    // pure-function unit tests.
    testTimeout: 15000,
    // Multiple integration test files share one real Postgres/Redis and
    // some (ingestion.test.ts, websocketGateway.test.ts) TRUNCATE the same
    // tables and ingest the same fixture in their own beforeAll — running
    // as separate files concurrently (Vitest's default) let one file's
    // TRUNCATE or insert race another's, surfacing as a spurious "duplicate
    // key" or timeout with no code defect behind it. Same class of fix as
    // frontend/playwright.config.ts's workers: 1, for the same reason:
    // fullyParallel-style settings alone don't stop *file-level*
    // concurrency, only within-file concurrency.
    fileParallelism: false,
  },
});
