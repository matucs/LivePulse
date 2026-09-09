import { test, expect } from "@playwright/test";
import { getAnyRealMatchId, publishMatchUpdate } from "./helpers";

/**
 * Captures every WebSocket the page creates into a page-global array before
 * any app code runs — the only way to reach into useMatchSocket's
 * encapsulated `ws` instance from outside the hook, without changing app
 * code just to make it testable.
 *
 * These tests check the captured socket's own `readyState` directly,
 * rather than the FreshnessIndicator's connection-status dot — that dot is
 * deliberately coupled to data freshness too (it only shows in the
 * non-stale branch, docs/websocket.md's implementation note), which is
 * correct product behavior but makes it an unreliable proxy for "is the
 * socket connected" in a test: this project's own real API-quota
 * exhaustion (from earlier real-key validation this session) can leave the
 * one currently-live match's data stale even while its socket is healthy,
 * which is exactly what happened the first time this test used the dot as
 * its signal.
 */
async function captureSockets(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __sockets: WebSocket[] }).__sockets = [];
    const OriginalWS = window.WebSocket;
    window.WebSocket = new Proxy(OriginalWS, {
      construct(target, args) {
        const ws = new target(...(args as ConstructorParameters<typeof WebSocket>));
        (window as unknown as { __sockets: WebSocket[] }).__sockets.push(ws);
        return ws;
      },
    });
  });
}

test("§25 live update: a real backend push updates the score with no page refresh", async ({ page }) => {
  await captureSockets(page);
  const matchId = await getAnyRealMatchId();
  await page.goto(`/match/${matchId}`);
  await page.waitForFunction(() => {
    const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets;
    return sockets.length > 0 && sockets[sockets.length - 1]!.readyState === WebSocket.OPEN;
  });

  // Same trick as backend/test/integration/websocketGateway.test.ts — a
  // raw Redis PUBLISH is exactly what scoresConsumer.ts does after
  // processing a real Kafka message (docs/adr/ADR-003's Phase 4 addendum).
  // Picking scores unlikely to already be the real ones so the assertion
  // can't pass by coincidence.
  await publishMatchUpdate(matchId, { homeScore: 17, awayScore: 4 });

  // 10s, matching the reconnect test's own margin below — a freshly
  // downloaded, cold-started browser on a shared CI runner has more
  // scheduling jitter than a warm local one; the mechanism itself (proven
  // by this same test passing consistently, just occasionally past 5s in
  // CI) isn't in question, only how much margin a CI runner needs.
  await expect(page.getByText("17", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("4", { exact: true })).toBeVisible();
});

test("§25 WebSocket reconnect: forcing the socket closed reconnects with a fresh connection", async ({ page }) => {
  await captureSockets(page);
  const matchId = await getAnyRealMatchId();
  await page.goto(`/match/${matchId}`);
  await page.waitForFunction(() => {
    const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets;
    return sockets.length > 0 && sockets[sockets.length - 1]!.readyState === WebSocket.OPEN;
  });

  const socketCountBefore = await page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.length);

  // Force-close the live socket — simulates a network blip, not a client
  // action, so the app has no direct signal beyond the 'close' event
  // useMatchSocket.ts's onclose handler reacts to.
  await page.evaluate(() => {
    const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets;
    sockets[sockets.length - 1]?.close();
  });

  // Reconnect uses backoff starting at 1s (docs/websocket.md) — a NEW
  // WebSocket instance reaching OPEN is the real evidence of a genuine
  // reconnect, not just the same connection lingering.
  await page.waitForFunction(
    (countBefore) => {
      const sockets = (window as unknown as { __sockets: WebSocket[] }).__sockets;
      return sockets.length > countBefore && sockets[sockets.length - 1]!.readyState === WebSocket.OPEN;
    },
    socketCountBefore,
    { timeout: 10_000 },
  );

  const socketCountAfter = await page.evaluate(() => (window as unknown as { __sockets: WebSocket[] }).__sockets.length);
  expect(socketCountAfter).toBeGreaterThan(socketCountBefore);
});
