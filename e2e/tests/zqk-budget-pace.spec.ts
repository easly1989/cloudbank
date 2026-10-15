import { expect, test } from "@playwright/test";

// The tick on the budget bars says what it is (#625): the big bar names it,
// "today, 13 October · 42% of the month", and a line's tick explains itself
// on hover, touch or keyboard focus, with that line's numbers. A line paid
// once a month at most lately, like rent, has no tick. On a wallet of its own;
// named "zqk-" so it runs after the main journey, whose admin it reuses, and
// it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth() + 1;
const firstOf = (back: number) => {
  const i = year * 12 + (month - 1) - back;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}-01`;
};
const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

test.use({ viewport: { width: 1440, height: 1000 } });

test("the budget's tick says what it means, and rent has none", async ({ page }) => {
  // On a month's last day there is no tick: nothing is left to pace.
  test.skip(now.getUTCDate() === lastDay, "no tick on the last day of the month");
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, months }) => {
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
        title: `Budget pace ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "bank",
        initialBalance: 500000,
      });
      const groceries = await call("POST", `${base}/categories`, { name: "Groceries" });
      const rent = await call("POST", `${base}/categories`, { name: "Rent" });
      await call("PUT", `${base}/budgets/${groceries.id}`, { mode: "same", same: -30000 });
      await call("PUT", `${base}/budgets/${rent.id}`, { mode: "same", same: -80000 });
      const txn = (date: string, amount: number, categoryId: number) =>
        call("POST", `${base}/transactions`, { accountId: acc.id, date, amount, categoryId });
      // Rent once on the 1st of each of the last three months: paid in one go.
      for (const m of months) await txn(m, -80000, rent.id);
      // Groceries many times a month.
      for (const m of months) {
        await txn(m, -4000, groceries.id);
        await txn(m, -6000, groceries.id);
      }
      await txn(months[0].slice(0, 8) + "01", -3000, groceries.id);
      return { wallet: w.id as number, groceries: groceries.id as number, rent: rent.id as number };
    },
    { h: H, months: [firstOf(0), firstOf(1), firstOf(2), firstOf(3)] },
  );
  await page.evaluate((id) => localStorage.setItem("cb.currentWalletId", String(id)), ids.wallet);
  await page.goto("/budget");

  await test.step("the big bar names its tick", async () => {
    await expect(page.getByTestId("budget-pace-label")).toHaveText(
      /^today, \S+ \d+ · \d+% of the month$/,
    );
  });

  const tick = page
    .getByTestId(`budget-row-${ids.groceries}`)
    .getByRole("button", { name: /^Today, / });

  await test.step("a line's tick explains itself on hover", async () => {
    await tick.hover();
    const tip = page.getByRole("tooltip");
    await expect(tip).toContainText(/% of the month has gone\./);
    await expect(tip).toContainText(/Here you have spent \d+% of the plan, so you are (below|ahead of) the pace\./);
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();
  });

  await test.step("and on keyboard focus, without opening the line", async () => {
    await tick.focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await tick.press("Enter");
    await expect(page.getByTestId("budget-sheet")).toBeHidden();
  });

  await test.step("rent, paid once a month, has no tick", async () => {
    await expect(page.getByTestId(`budget-row-${ids.rent}`)).toBeVisible();
    await expect(
      page.getByTestId(`budget-row-${ids.rent}`).getByRole("button", { name: /^Today, / }),
    ).toHaveCount(0);
  });
});
