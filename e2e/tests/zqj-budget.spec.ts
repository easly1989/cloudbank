import { type Page, expect, test } from "@playwright/test";

// The Budget page (#568): the month's answer first, a line per budget, a
// parent's budget covering its subcategories without one of their own,
// spending with no budget apart (not over), income on its own; the sheet adds
// a budget, keeps one to this year only, and ⋯ takes one out; what is entered
// but dated later is still to come. On a wallet of its own, seeded here.
// Named "zqj-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const year = now.getUTCFullYear();
const month = now.getUTCMonth() + 1;
const firstOf = (y: number, m: number) => {
  const i = y * 12 + (m - 1);
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}-01`;
};
const thisMonth = firstOf(year, month);
const nextMonth = firstOf(year, month + 1);
const twoMonthsAgo = firstOf(year, month - 2);

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, thisMonth, nextMonth, twoMonthsAgo }) => {
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
        preferences: {
          ...(me.preferences ?? {}),
          tutorialSeen: true,
          tourOffers: false,
        },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Budget ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "bank",
        initialBalance: 500000,
      });
      const cat = (name: string, parentId?: number, isIncome = false) =>
        call("POST", `${base}/categories`, { name, parentId, isIncome });
      const food = await cat("Food");
      const groceries = await cat("Groceries", food.id);
      const dining = await cat("Dining", food.id);
      const health = await cat("Health");
      const salary = await cat("Salary", undefined, true);
      const budget = (id: number, same: number) =>
        call("PUT", `${base}/budgets/${id}`, { mode: "same", same });
      await budget(food.id, -30000);
      await budget(dining.id, -5000);
      await budget(salary.id, 200000);
      const txn = (date: string, amount: number, categoryId: number) =>
        call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date,
          amount,
          categoryId,
        });
      await txn(thisMonth, -20000, groceries.id);
      await txn(thisMonth, -8000, dining.id);
      await txn(thisMonth, -3000, health.id);
      await txn(thisMonth, 200000, salary.id);
      await txn(nextMonth, -5000, groceries.id);
      await txn(twoMonthsAgo, -40000, groceries.id);
      return {
        wallet: w.id as number,
        base,
        food: food.id as number,
        dining: dining.id as number,
        health: health.id as number,
        salary: salary.id as number,
      };
    },
    { h: H, thisMonth, nextMonth, twoMonthsAgo },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

const get = (page: Page, url: string) =>
  page.evaluate(async (u) => (await fetch(u)).json(), url);

test("budget: the month's answer, lines, the sheet, this year only and remove", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/budget");
  const table = page.getByTestId("budget-table");
  const row = (id: number) => page.getByTestId(`budget-row-${id}`);

  await test.step("the answer first, over the budgeted spending only", async () => {
    // Food 200 (its Groceries) + Dining 80, of 300 + 50 planned.
    await expect(page.getByTestId("budget-spent")).toContainText(/280[,.]00/);
    await expect(page.getByText(/of 350[,.]00.*planned/)).toBeVisible();
    await expect(page.getByText("1 category over")).toBeVisible();
  });

  await test.step("a parent's budget covers its subcategories without one", async () => {
    await expect(row(ids.food)).toContainText(/200[,.]00/);
    await expect(row(ids.dining)).toContainText("Food › Dining");
    await expect(row(ids.dining)).toContainText(/30[,.]00.*over/);
    // Health has no budget: listed apart, not over anything.
    const health = page.getByTestId(`budget-loose-${ids.health}`);
    await expect(health).toContainText("Health");
    await expect(health).not.toContainText("over");
    await expect(table).toContainText("Expected income");
    await expect(row(ids.salary)).toContainText("all in");
  });

  await test.step("Add to budget on a line with none opens the sheet", async () => {
    await page
      .getByTestId(`budget-loose-${ids.health}`)
      .getByRole("button", { name: "Add to budget" })
      .click();
    const sheet = page.getByTestId("budget-sheet");
    await expect(sheet).toContainText("Health");
    await sheet.getByRole("textbox", { name: "Each month" }).fill("50");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(row(ids.health)).toContainText(/20[,.]00/);
    await expect(page.getByTestId(`budget-loose-${ids.health}`)).toHaveCount(0);
  });

  await test.step("this year only keeps the every-year plan", async () => {
    await row(ids.dining).click();
    const sheet = page.getByTestId("budget-sheet");
    await expect(sheet.getByTestId("budget-history")).toContainText(
      "The last 12 months",
    );
    await sheet.getByRole("textbox", { name: "Each month" }).fill("100");
    await sheet.getByText(`${year} only`, { exact: true }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(row(ids.dining)).not.toContainText("over");
    const only = await get(page, `${ids.base}/budgets?year=${year}`);
    expect(only).toEqual([
      expect.objectContaining({ categoryId: ids.dining, same: -10000 }),
    ]);
    const every = await get(page, `${ids.base}/budgets?year=0`);
    expect(
      every.find((b: { categoryId: number }) => b.categoryId === ids.dining)
        .same,
    ).toBe(-5000);
  });

  await test.step("Remove from budget gives its spending back to the parent", async () => {
    await row(ids.dining).hover();
    await row(ids.dining)
      .getByRole("button", { name: "Actions for Dining" })
      .click();
    await page.getByRole("menuitem", { name: "Remove from budget" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove from budget" })
      .click();
    await expect(row(ids.dining)).toHaveCount(0);
    await expect(row(ids.food)).toContainText(/280[,.]00/);
    expect(await get(page, `${ids.base}/budgets?year=${year}`)).toEqual([]);
  });

  await test.step("next month: what is entered is still to come", async () => {
    await page.getByRole("button", { name: "Next" }).click();
    await expect(row(ids.food)).toContainText(/\+ 50[,.]00.*to come/);
    await expect(page.getByTestId("budget-spent")).toContainText(/0[,.]00/);
  });

  await test.step("the year view", async () => {
    await page.getByText("Year", { exact: true }).click();
    await expect(page.getByTestId("budget-period-name")).toHaveText(
      String(year + (month === 12 ? 1 : 0)),
    );
  });
});
