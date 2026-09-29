import { expect, test } from "@playwright/test";

// Filters on a phone (#502): the register's toolbar keeps one line and only
// the count, the panel rises over the ledger with the chips at its head, and
// a ledger emptied by its filters says so rather than calling the account
// empty. Named "zv-" so it runs after the main journey, whose admin it reuses.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("a phone shows the filters' count, and their chips in the panel", async ({
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
          name: `Phone filters ${Date.now()}`,
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

  // Three filters on, one of which hides the only row.
  await page.goto(`/transactions?account=${accountId}&xf=none&hf=1&amin=-100`);
  const toolbar = page.locator('[data-tour="register-toolbar"]');
  const filters = toolbar.getByRole("button", {
    name: /^Filters \(3\)$/,
  });

  await test.step("the toolbar keeps one line and the count", async () => {
    await expect(filters).toBeVisible();
    await expect(toolbar.getByTestId("filter-chips")).toHaveCount(0);
    const box = (await toolbar.boundingBox())!;
    expect(box.height).toBeLessThan(60);
  });

  await test.step("an emptied ledger says the filters did it", async () => {
    await expect(
      page.getByText("No transaction matches the filters."),
    ).toBeVisible();
  });

  await test.step("the panel opens on screen, chips first", async () => {
    await filters.click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844 + 1);
    const chips = sheet.getByTestId("filter-chips");
    await expect(chips).toContainText("No transfers");
    await chips
      .getByRole("button", { name: "Remove the Minimum amount filter" })
      .click();
    await expect(
      sheet.getByRole("button", { name: "Show 1 transaction" }),
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Show 1 transaction" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(
      toolbar.getByRole("button", { name: /^Filters \(2\)$/ }),
    ).toBeVisible();
    await expect(page.getByText("Coffee")).toBeVisible();
  });
});
