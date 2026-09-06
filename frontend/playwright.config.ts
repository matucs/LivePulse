import { defineConfig, devices } from "@playwright/test";

/**
 * §25's E2E requirement — match page, live update, WebSocket reconnect,
 * error states. Uses the system's installed Chrome (`channel: "chrome"`)
 * rather than downloading Playwright's own ~300MB bundled browser, since a
 * real Chrome is already present in this environment and in most CI
 * runners' base images.
 *
 * Requires the real backend (docker compose up + `npm run dev` in
 * backend/) already running on :4000 — these tests exercise the actual
 * REST/WebSocket API, not a mocked one, matching this project's "verify
 * against real data" discipline throughout. `webServer` below only starts
 * the frontend; the backend + its Postgres/Redis/Kafka are a separate,
 * already-established precondition (see docs/deployment.md).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // shares one backend + one seeded match across the suite — see e2e/fixtures.ts
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
