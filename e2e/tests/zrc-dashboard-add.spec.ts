import { expect, type Page, test } from "@playwright/test";

// The overview's "Add transaction" opens the entry sheet right there (#624),
// on the default account or the first open one, and the figures follow the
// save. It used to send the reader to /transactions?new=1, where restoring the
// register's saved filters rewrote the whole address and dropped new=1, so the
// sheet shut as it opened. That link must still work for anyone else using it.
// On a wallet of its own; named "zrc-" so it runs after the main journey, whose
// admin it reuses, and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

async function setUp(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h }) => {
      const call = async (method: string, url: string, body?: unknown) => {
        const r = await fetch(url, {
          method,
          headers: h,
          body: body ? JSON.stringify(body) : undefined,
        });
        return r.status === 204 ? null : r.json();
      };
      const needsSetup = (await call("GET", "/api/v1/setup/status")).needsSetup as boolean;
      await call(
        "POST",
        needsSetup ? "/api/v1/setup" : "/api/v1/auth/login",
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      );
      const me = await call("GET", "/api/v1/auth/me");
      const w = await call("POST", "/api/v1/wallets", {
        title: `Overview add ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 10000,
      });
      const savings = await call("POST", `${base}/accounts`, {
        name: "Savings",
        type: "savings",
        initialBalance: 0,
      });
      // Savings is the default account, so the sheet must not open on the first.
      await call("PATCH", "/api/v1/auth/me", {
        preferences: {
          ...(me.preferences ?? {}),
          tutorialSeen: true,
          tourOffers: false,
          defaultAccountId: savings.id,
        },
      });
      return { wallet: w.id as number, base, savings: savings.id as number };
    },
    { h: H },
  );
  await page.evaluate((id) => localStorage.setItem("cb.currentWalletId", String(id)), ids.wallet);
  return ids;
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("the overview's Add transaction opens the sheet on the overview", async ({ page }) => {
  test.setTimeout(120_000);
  const ids = await setUp(page);
  await page.goto("/");
  await expect(page.getByText("Balance today")).toBeVisible();

  // The header's button, not the Add transaction widget's.
  await page.locator(".cb-page-actions").getByText("Add transaction", { exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // Still on the overview, under the sheet.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Balance today")).toBeAttached();
  await expect(sheet).toBeVisible();
  // The default account, and it can be changed in the sheet.
  const account = sheet.getByRole("combobox", { name: "Account", exact: true });
  await expect(account).toHaveValue("Savings");
  await account.click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();
  await expect(account).toHaveValue("Checking");

  await sheet.getByRole("textbox", { name: "Amount", exact: true }).fill("12.34");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  // Saved to Checking, and the overview's figures caught up without a reload.
  const register = await page.evaluate(
    async ({ base }) => {
      const accounts = await (await fetch(`${base}/accounts`)).json();
      const checking = accounts.find((a: { name: string }) => a.name === "Checking");
      return (await (await fetch(`${base}/transactions/register?accountId=${checking.id}`)).json())
        .rows;
    },
    { base: ids.base },
  );
  expect(register.map((r: { amount: number }) => r.amount)).toContain(-1234);
  await expect(page.getByText(/87\.66/).first()).toBeVisible();
});

test("?new=1 opens the sheet even when the register has saved filters", async ({ page }) => {
  test.setTimeout(120_000);
  const ids = await setUp(page);
  await page.evaluate(
    (id) => localStorage.setItem(`cb.reg.filters.${id}`, "hf=1"),
    ids.wallet,
  );
  await page.goto("/transactions?new=1");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Amount", exact: true })).toBeVisible();
  // The saved filter came back too.
  await expect(page).toHaveURL(/hf=1/);
  await page.waitForTimeout(500);
  await expect(sheet).toBeVisible();
});
