import { expect, test } from "@playwright/test";

// A schedule edited, saved and opened again shows what was saved, and a second
// save does not put the old values back. The sheet takes the name, the amount
// and the memo from the schedule's template, so a template list left stale
// after the first save reopened the sheet on the values from before it. On a
// wallet of its own; named "zrb-" so it runs after the main journey, whose
// admin it reuses, and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("a schedule opened again after a save shows the saved values", async ({ page }) => {
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
        title: `Schedule reopen ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 0,
      });
      const tpl = await call("POST", `${base}/templates`, {
        name: "Gym",
        accountId: acc.id,
        amount: -3000,
        memo: "Gym membership",
      });
      const next = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
      const s = await call("POST", `${base}/schedules`, {
        templateId: tpl.id,
        unit: "month",
        everyN: 1,
        nextDue: next,
        autoPost: false,
      });
      return { wallet: w.id as number, base, template: tpl.id as number, schedule: s.id as number };
    },
    { h: H },
  );
  await page.evaluate((id) => localStorage.setItem("cb.currentWalletId", String(id)), ids.wallet);

  await page.goto(`/schedules?view=list&schedule=${ids.schedule}`);
  const sheet = page.getByTestId("schedule-sheet");
  const name = sheet.getByRole("textbox", { name: "Name", exact: true });
  const amount = sheet.getByRole("textbox", { name: "Amount", exact: true });
  const memo = sheet.getByRole("textbox", { name: "Memo", exact: true });

  await test.step("edit the name, the amount and the memo, and save", async () => {
    await expect(name).toHaveValue("Gym");
    await name.fill("Swimming pool");
    await amount.fill("45");
    await sheet.getByRole("button", { name: "More details" }).click();
    await memo.fill("Pool membership");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
  });

  await test.step("opened again from the list, the sheet shows what was saved", async () => {
    await page.getByRole("button", { name: /Swimming pool/ }).first().click();
    await expect(sheet).toBeVisible();
    await expect(name).toHaveValue("Swimming pool");
    await expect(amount).toHaveValue("45.00");
    await sheet.getByRole("button", { name: "More details" }).click();
    await expect(memo).toHaveValue("Pool membership");
  });

  await test.step("a second save keeps the new values", async () => {
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    const tpl = await page.evaluate(
      async ({ base, id }) =>
        (await (await fetch(`${base}/templates`)).json()).find((t: { id: number }) => t.id === id),
      { base: ids.base, id: ids.template },
    );
    expect(tpl.name).toBe("Swimming pool");
    expect(tpl.amount).toBe(-4500);
    expect(tpl.memo).toBe("Pool membership");
  });
});

// The same for a transfer edited from the register: its sheet seeds itself
// from the transfer as fetched, and that copy was never refreshed after a save.
test("a transfer opened again after a save shows the saved memo", async ({ page }) => {
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
        title: `Transfer reopen ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const checking = await call("POST", `${base}/accounts`, { name: "Checking", type: "checking" });
      const savings = await call("POST", `${base}/accounts`, { name: "Savings", type: "savings" });
      const tr = await call("POST", `${base}/transfers`, {
        fromAccountId: checking.id,
        toAccountId: savings.id,
        date: "2026-03-01",
        fromAmount: 10000,
        memo: "Monthly saving",
      });
      return { wallet: w.id as number, base, account: checking.id as number, transfer: tr.id as number };
    },
    { h: H },
  );
  await page.evaluate((id) => localStorage.setItem("cb.currentWalletId", String(id)), ids.wallet);
  await page.goto(`/transactions?account=${ids.account}`);

  const sheet = page.getByRole("dialog");
  const memo = sheet.getByLabel("Memo", { exact: true });
  await page.getByText("Monthly saving", { exact: true }).first().dblclick();
  await expect(memo).toHaveValue("Monthly saving");
  await memo.fill("Holiday fund");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByText("Holiday fund", { exact: true }).first().dblclick();
  await expect(memo).toHaveValue("Holiday fund");
});
