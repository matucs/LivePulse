import { test, expect } from "@playwright/test";

/**
 * §3's home page, against the real running backend. Doesn't assume
 * anything is currently live (docs/technical-decisions.md §2 — that's the
 * common case, not an edge case) — just that the page renders something
 * intentional rather than an error or a blank screen.
 */
test("home page loads and renders the LivePulse header", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner").getByText("LivePulse")).toBeVisible();
  await expect(page.getByText("Engineering Dashboard")).toBeVisible(); // nav link, always present regardless of match data
});

test("home page does not show a raw error or blank page even with no live matches", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  // Whatever combination of live/recent/upcoming exists, the page should
  // never render nothing at all under the header/footer chrome.
  await expect(page.locator("main")).not.toBeEmpty();
});
