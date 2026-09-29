import { expect, test, type Locator } from "@playwright/test";

// Filters on a desktop (#535): the chips live only in the panel, a red × on
// the Filters button clears them all, a ledger the filters empty is replaced
// by the message beside the panel, the panel is as tall as the ledger with its
// fields as wide as it, and the columns can be open alongside it. Named "zva-"
// so it runs after the main journey, whose admin it reuses.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 900 } });

const box = async (l: Locator) => (await l.boundingBox())!;

test("desktop filters: chips in the panel, a red ×, no empty ledger", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const accountId = await page.evaluate(async (H) => {
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
      .needsSetup as boolean;
    await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
      method: "POST",
      headers: H,
      body: JSON.stringify(
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      ),
    });
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({
        preferences: { tutorialSeen: true, tourOffers: false },
      }),
    });
    let wallets = await (await fetch("/api/v1/wallets")).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ title: "Filters", baseCurrency: "EUR" }),
      });
      wallets = await (await fetch("/api/v1/wallets")).json();
    }
    const w = wallets[0].id;
    const acc = await (
      await fetch(`/api/v1/wallets/${w}/accounts`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          name: `Desk filters ${Date.now()}`,
          type: "bank",
        }),
      })
    ).json();
    await fetch(`/api/v1/wallets/${w}/transactions`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        accountId: acc.id,
        date: "2026-01-15",
        amount: -1250,
        memo: "Coffee",
      }),
    });
    return acc.id as number;
  }, H);

  const toolbar = page.locator('[data-tour="register-toolbar"]');
  const ledger = page.getByRole("region", { name: "Account ledger" });

  await test.step("two filters: no chips in the toolbar, a count and a red ×", async () => {
    await page.goto(`/transactions?account=${accountId}&xf=none&hf=1`);
    await expect(
      toolbar.getByRole("button", { name: "Filters (2)" }),
    ).toBeVisible();
    await expect(toolbar.getByTestId("filter-chips")).toHaveCount(0);
    await expect(
      toolbar.getByRole("button", { name: "Clear all filters" }),
    ).toBeVisible();
    await expect(page.getByText("Coffee")).toBeVisible();
  });

  await test.step("the panel: chips at its head, as tall as the ledger, fields full width", async () => {
    await toolbar.getByRole("button", { name: "Filters (2)" }).click();
    const panel = page
      .getByTestId("register-panel")
      .filter({ hasText: "Date range" });
    await expect(panel.getByTestId("filter-chips")).toContainText(
      "No transfers",
    );
    // The ledger's card and the panel end on the same line.
    const card = await box(
      ledger.locator("xpath=ancestor::div[contains(@style,'overflow-x')][1]"),
    );
    const p = await box(panel);
    expect(
      Math.abs(card.y + card.height - (p.y + p.height)),
    ).toBeLessThanOrEqual(2);
    // Every field is as wide as the first one, the tags included.
    const first = await box(panel.locator(".mantine-Select-root").first());
    const tags = await box(panel.locator(".mantine-TagsInput-root"));
    expect(first.width).toBeGreaterThan(240);
    expect(Math.abs(tags.width - first.width)).toBeLessThanOrEqual(2);
  });

  await test.step("the columns open under the filters, both at once", async () => {
    await toolbar.getByRole("button", { name: "Columns" }).click();
    const filtersTitle = await box(page.getByText("Date range"));
    const columnsHint = await box(page.getByText("Yours, and remembered."));
    expect(columnsHint.y).toBeGreaterThan(filtersTitle.y);
    await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
    await toolbar.getByRole("button", { name: "Columns" }).click();
    await expect(page.getByText("Yours, and remembered.")).toHaveCount(0);
  });

  await test.step("filters that hide every row replace the ledger with the message", async () => {
    await page.goto(
      `/transactions?account=${accountId}&xf=none&hf=1&amin=-100`,
    );
    await expect(
      page.getByText("No transaction matches the filters."),
    ).toBeVisible();
    await expect(ledger).toHaveCount(0);
  });

  await test.step("the red × clears them all", async () => {
    await toolbar.getByRole("button", { name: "Clear all filters" }).click();
    await expect(
      toolbar.getByRole("button", { name: "Filters", exact: true }),
    ).toBeVisible();
    await expect(
      toolbar.getByRole("button", { name: "Clear all filters" }),
    ).toHaveCount(0);
    await expect(page.getByText("Coffee")).toBeVisible();
  });
});
