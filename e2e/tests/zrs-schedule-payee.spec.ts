import { expect, test } from "@playwright/test";

// A schedule saved before a payee was required (#723) is flagged on the
// Schedules page, completed from the banner one sheet at a time, and its payee
// given to the transactions it registered without one. On a wallet of its
// own; named "zrs-" so it runs after the main journey, whose admin it reuses,
// and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("a schedule without a payee is completed from the banner", async ({ page }) => {
  test.setTimeout(120_000);
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
      await call("PATCH", "/api/v1/auth/me", {
        preferences: { ...(me.preferences ?? {}), tutorialSeen: true, tourOffers: false },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Schedule payee ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, { name: "Checking", type: "checking" });
      const gym = await call("POST", `${base}/payees`, { name: "Gym Co" });
      const tpl = await call("POST", `${base}/templates`, {
        name: "Gym",
        accountId: acc.id,
        amount: -3000,
        payeeId: gym.id,
      });
      const next = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
      await call("POST", `${base}/schedules`, {
        templateId: tpl.id,
        unit: "month",
        everyN: 1,
        nextDue: next,
        autoPost: false,
      });
      // What an imported schedule looks like: its template has no payee, and
      // neither have the transactions it registered.
      await call("PATCH", `${base}/templates/${tpl.id}`, {
        name: "Gym",
        accountId: acc.id,
        amount: -3000,
      });
      for (const date of ["2026-08-01", "2026-09-01"])
        await call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date,
          amount: -3000,
          templateId: tpl.id,
        });
      return { wallet: w.id as number, base, account: acc.id as number, payee: gym.id as number };
    },
    { h: H },
  );
  await page.evaluate((id) => localStorage.setItem("cb.currentWalletId", String(id)), ids.wallet);

  await page.goto("/schedules?view=list");
  const banner = page.getByTestId("missing-payee-banner");
  await expect(banner).toContainText("1 schedule without a payee");
  await expect(page.getByTestId("schedules-list")).toContainText("No payee");

  const sheet = page.getByTestId("schedule-sheet");
  await test.step("the banner opens it, with the payee missing", async () => {
    await banner.getByRole("button", { name: "Complete them one by one" }).click();
    await expect(sheet.getByTestId("payee-walk")).toHaveText("Without a payee: 1 of 1");
    await expect(sheet.getByText("Choose a payee")).toBeVisible();
  });

  await test.step("a payee is picked and given to the registered transactions", async () => {
    const payee = sheet.getByRole("combobox", { name: /Payee/ });
    await payee.click();
    await payee.fill("Gym");
    await page.getByRole("option", { name: "Gym Co", exact: true }).click();
    const backfill = sheet.getByRole("checkbox", {
      name: "Also apply it to the 2 registered transactions without a payee",
    });
    await expect(backfill).toBeChecked();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(banner).toBeHidden();
  });

  const payees = await page.evaluate(
    async ({ base, account }) =>
      (await (await fetch(`${base}/transactions?accountId=${account}`)).json()).transactions.map(
        (t: { payeeId?: number }) => t.payeeId ?? null,
      ),
    { base: ids.base, account: ids.account },
  );
  expect(payees).toEqual([ids.payee, ids.payee]);
});
