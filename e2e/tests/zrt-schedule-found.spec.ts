import { expect, test } from "@playwright/test";

// The recurring payments found in the transactions (#693): a payee paid every
// month with no schedule is offered on the Schedules page, made a schedule
// from a prefilled sheet, or ignored for good. On a wallet of its own; named
// "zrt-" so it runs after the main journey, whose admin it reuses, and it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("a recurring payment is offered, made a schedule, or ignored", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const wallet = await page.evaluate(
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
      await call("PATCH", "/api/v1/auth/me", {
        preferences: { ...(me.preferences ?? {}), tutorialSeen: true, tourOffers: false },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Found payments ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, { name: "Checking", type: "checking" });
      // Four payments a month apart, the last ten days ago, for each payee.
      const ago = (days: number) =>
        new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      for (const [name, amount] of [
        ["StreamFlix", -1299],
        ["City Bus", -3500],
      ] as const) {
        const p = await call("POST", `${base}/payees`, { name });
        for (const days of [100, 70, 40, 10])
          await call("POST", `${base}/transactions`, {
            accountId: acc.id,
            date: ago(days),
            amount,
            payeeId: p.id,
          });
      }
      return w.id as number;
    },
    { h: H },
  );
  await page.evaluate((id) => localStorage.setItem("cb.currentWalletId", String(id)), wallet);

  await page.goto("/schedules?view=list");
  const card = page.getByTestId("found-payments");
  const items = card.getByTestId("found-payment");
  await test.step("both are offered, the costlier first", async () => {
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("City Bus");
    await expect(items.nth(0)).toContainText("Every month");
    await expect(items.nth(0)).toContainText("4 times since");
    await expect(items.nth(0)).toContainText("/year");
    await expect(items.nth(1)).toContainText("StreamFlix");
  });

  await test.step("an ignored one stays away", async () => {
    await items.nth(0).getByRole("button", { name: "Ignore" }).click();
    await expect(items).toHaveCount(1);
    await page.reload();
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText("StreamFlix");
  });

  const sheet = page.getByTestId("schedule-sheet");
  await test.step("one is made a schedule from a filled-in sheet", async () => {
    await items.nth(0).getByRole("button", { name: "Create schedule" }).click();
    await expect(sheet.getByLabel("Name", { exact: true })).toHaveValue("StreamFlix");
    await expect(sheet.getByLabel("Amount", { exact: true })).toHaveValue("12.99");
    await expect(sheet.getByRole("combobox", { name: /Payee/ })).toHaveValue("StreamFlix");
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(card).toBeHidden();
    const list = page.getByTestId("schedules-list");
    await expect(list).toContainText("StreamFlix");
    await expect(list).toContainText("/year");
  });
});
