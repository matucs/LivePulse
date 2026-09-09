import { defineConfig, devices } from "@playwright/test";

/**
 * §25's E2E requirement — match page, live update, WebSocket reconnect,
 * error states. Uses Playwright's own bundled Chromium, not the system's
 * installed Chrome (`channel: "chrome"`) — tried that first to skip a
 * ~300MB download, but CI's first real runs showed it depends on Google's
 * own Chrome apt repository, which served a stale, hash-mismatched package
 * index two runs in a row (a real, external, non-transient failure, not
 * this project's code). Playwright's own CDN has been reliable across the
 * same runs — one dependency removed, not worked around.
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
  fullyParallel: false,
  // `fullyParallel: false` only stops tests *within one file* from running
  // concurrently — Playwright still spins up multiple workers across
  // *different* files unless told not to, which is exactly what CI's first
  // real run caught: the live-update and reconnect tests share one backend
  // + one seeded match (e2e/helpers.ts), and running in different workers
  // let them race on the same match's Redis pub/sub channel — one test's
  // socket churn (reconnect) briefly dropped the channel's only local
  // subscriber right as the other published to it, hitting the exact
  // no-delivery-guarantee tradeoff ADR-006 already documents, just
  // triggered by test-suite parallelism, not the product. `workers: 1`
  // is what actually serializes the whole suite.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // "list" alone never writes a report to disk — CI's upload-artifact step
  // for frontend/playwright-report/ was a silent no-op until this, found
  // from the first real CI run's own "No files were found" warning.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
