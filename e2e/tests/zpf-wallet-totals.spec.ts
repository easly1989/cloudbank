import { expect, test } from "@playwright/test";

// The wallet's total is a sum, and says so (#579): the wallet card and the
// overview's headline name how many accounts they add up, and open them one by
// one. An account set to stay out of the totals is counted out, and shown to be.
// Named "zpf-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("the wallet's total names its accounts and opens them", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const wallet = await page.evaluate(async (h) => {
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await fetch(url, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      return r.status === 204 ? null : r.json();
    };
    const needsSetup = (await call("GET", "/api/v1/setup/status"))
      .needsSetup as boolean;
    await call(
      "POST",
      needsSetup ? "/api/v1/setup" : "/api/v1/auth/login",
      needsSetup
        ? { username: "admin", email: "a@b.com", password: "supersecret1" }
        : { username: "admin", password: "supersecret1" },
    );
    const me = await call("GET", "/api/v1/auth/me");
    await call("PATCH", "/api/v1/auth/me", {
      preferences: { ...me.preferences, tutorialSeen: true, tourOffers: false },
    });
    const w = await call("POST", "/api/v1/wallets", {
      title: `Totals ${Date.now()}`,
      baseCurrency: "EUR",
    });
    const accounts = `/api/v1/wallets/${w.id}/accounts`;
    await call("POST", accounts, {
      name: "Current",
      type: "bank",
      initialBalance: 10000,
    });
    await call("POST", accounts, {
      name: "Wallet cash",
      type: "cash",
      initialBalance: 5000,
    });
    await call("POST", accounts, {
      name: "Pension fund",
      type: "bank",
      initialBalance: 99900,
      noSummary: true,
    });
    return w.id as number;
  }, H);
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    wallet,
  );
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // The card: how many accounts, and how many are left out.
  const card = page.getByRole("button", { name: "Switch wallet" });
  await expect(card).toContainText("Wallet · 2 of 3 accounts");
  await card.click();
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Today, across 2 accounts");
  await expect(menu).toContainText("Current");
  await expect(menu).toContainText("Wallet cash");
  await expect(menu).not.toContainText("Pension fund");
  await expect(menu).toContainText(/Total\s*150[.,]00/);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // The overview's headline opens the same accounts, and leads to them.
  const label = page.getByRole("button", {
    name: "Balance today · 2 of 3 accounts",
  });
  await label.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Today, across 2 accounts");
  await expect(dialog).not.toContainText("Pension fund");
  await dialog.getByRole("link", { name: "See the accounts" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(dialog).toBeHidden();
});
