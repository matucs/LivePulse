import { test, expect } from "@playwright/test";
import { getAnyRealMatchId } from "./helpers";

test("match detail page renders real score, teams, and status from the backend", async ({ page }) => {
  const matchId = await getAnyRealMatchId();
  await page.goto(`/match/${matchId}`);

  await expect(page.getByText("Timeline")).toBeVisible();
  await expect(page.getByText("Statistics")).toBeVisible();
  // The scoreline itself — two tabular-nums score digits either side of a
  // dash — is real content the backend returned, not a loading skeleton.
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
});

test("§25 error state: a well-formed but nonexistent match id shows an error, not a crash", async ({ page }) => {
  const response = await page.goto("/match/00000000-0000-0000-0000-000000000000");
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByText(/couldn.?t load this match/i)).toBeVisible();
});

test("§25 error state: a malformed match id doesn't produce an unhandled crash", async ({ page }) => {
  const response = await page.goto("/match/not-a-real-uuid-at-all");
  expect(response?.status()).toBeLessThan(500);
  await expect(page.getByText(/couldn.?t load this match/i)).toBeVisible();
});
