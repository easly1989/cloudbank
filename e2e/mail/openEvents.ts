import { expect, type Page } from "@playwright/test";

/**
 * A channel's page lists its events by group, each group a row that opens
 * under it (#800). This opens them all, so the events' boxes can be read.
 */
export async function openEvents(page: Page) {
  await expect(
    page.getByRole("button", { name: "Security", exact: true }),
  ).toBeVisible();
  const closed = page.locator('main section button[aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
}
