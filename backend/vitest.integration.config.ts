import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    // Real Postgres/Redis + full-tick ingestion can take a bit longer than
    // pure-function unit tests.
    testTimeout: 15000,
  },
});
