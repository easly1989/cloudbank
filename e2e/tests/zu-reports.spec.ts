import { type Page, expect, test } from "@playwright/test";

// The reports answer their question first (#488): what was spent and where
// (#490), what came in and went out (#491), what the accounts hold (#492), what
// a car costs (#493). Each on a wallet of its own, seeded here, so the figures
// are known.
//
// Mantine's segmented control hides its radios: the label is what takes a click.
const segment = (page: Page, name: string) =>
  page.locator("label", { hasText: new RegExp(`^${name}$`) });

// Named "zu-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const thisMonth = (d: number) =>
  day(new Date(now.getFullYear(), now.getMonth(), d));
const lastMonth = (d: number) =>
  day(new Date(now.getFullYear(), now.getMonth() - 1, d));

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const walletId = await page.evaluate(
    async ({ h, dates }) => {
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
      await call("PATCH", "/api/v1/auth/me", {
        preferences: { tutorialSeen: true, tourOffers: false },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Reports ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const checking = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 60000,
        minimumBalance: 20000,
      });
      const savings = await call("POST", `${base}/accounts`, {
        name: "Savings",
        type: "savings",
        initialBalance: 0,
      });
      const cat = async (name: string) =>
        (await call("POST", `${base}/categories`, { name })).id;
      const home = await cat("Home");
      const food = await cat("Food");
      const salary = await cat("Salary");
      const txn = (
        date: string,
        amount: number,
        categoryId?: number,
        extra = {},
      ) =>
        call("POST", `${base}/transactions`, {
          accountId: checking.id,
          date,
          amount,
          categoryId,
          ...extra,
        });
      // Last month: rent took Checking under its 200,00 € minimum.
      await txn(dates.last5, -50000, home);
      await txn(dates.last6, -1000, food);
      await txn(dates.last7, 250000, salary);
      // This month.
      await txn(dates.this1, -50000, home);
      await txn(dates.this1, -3000, food);
      await txn(dates.this1, 250000, salary);
      await call("POST", `${base}/transfers`, {
        fromAccountId: checking.id,
        toAccountId: savings.id,
        date: dates.this1,
        fromAmount: 10000,
      });
      // A car: two full fills, 500 km apart, 30 litres.
      const car = await call("POST", `${base}/vehicles`, {
        name: "Family car",
      });
      await txn(dates.last5, -6000, undefined, {
        memo: "d=1000 v=40",
        vehicleId: car.id,
      });
      await txn(dates.last7, -4500, undefined, {
        memo: "d=1500 v=30",
        vehicleId: car.id,
      });
      return w.id as number;
    },
    {
      h: H,
      dates: {
        last5: lastMonth(5),
        last6: lastMonth(6),
        last7: lastMonth(7),
        this1: thisMonth(1),
      },
    },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    walletId,
  );
}

test("each report tab answers its question", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page);

  await test.step("spending: this month, ranked, against last month", async () => {
    await page.goto("/reports");
    await expect(page.getByTestId("spending-total")).toContainText("530");
    const rows = page.getByTestId("spending-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Home");
    await expect(rows.nth(1)).toContainText("Food");
    // Food: 30,00 € against 10,00 € last month.
    await expect(rows.nth(1)).toContainText("+20");
    await expect(page.getByTestId("spending-compare")).toContainText("more");

    // A row opens its transactions, and the way to the register.
    await rows.nth(1).click();
    const drill = page.getByTestId("spending-drill");
    await expect(drill).toContainText("-30");
    const link = page.getByRole("link", { name: "Show it in the register" });
    await expect(link).toHaveAttribute("href", /cat=\d+/);
    await expect(link).toHaveAttribute("href", /account=\d+/);
  });

  await test.step("income is its own list, never mixed with spending", async () => {
    await segment(page, "Income").click();
    await expect(page).toHaveURL(/ty=income/);
    const rows = page.getByTestId("spending-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Salary");
  });

  await test.step("the period steps back, in the URL", async () => {
    await segment(page, "Spending").click();
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(page).toHaveURL(new RegExp(`at=${lastMonth(1)}`));
    await expect(page.getByTestId("spending-total")).toContainText("510");
  });

  await test.step("cash flow: in and out apart, the transfer left out", async () => {
    await page.goto("/reports?tab=cashflow&p=month");
    const table = page.getByTestId("cashflow-table");
    await expect(table).toBeVisible();
    // In 2.500,00; out 530,00 — not 630,00, which would count the transfer.
    await expect(page.getByTestId("cashflow-kept")).toContainText(/1[.,]970/);
    await expect(table).toContainText("so far");
  });

  await test.step("balances: today, per account, and a minimum crossed in words", async () => {
    await page.goto("/reports?tab=balances&p=all");
    await expect(page.getByTestId("balances-today")).toContainText(/4[.,]455/);
    const accounts = page.getByTestId("balances-account");
    await expect(accounts).toHaveCount(2);
    await expect(accounts.filter({ hasText: "Checking" })).toContainText(
      /Went under its 200[.,]00 € minimum/,
    );
  });

  await test.step("vehicle: cost per km and consumption first", async () => {
    await page.goto("/reports?tab=vehicle&p=all");
    await expect(page.getByTestId("vehicle-consumption")).toContainText(
      /6[.,]0 L\/100km/,
    );
    await expect(page.getByTestId("vehicle-fills")).toContainText("500");
  });
});

test("no report scrolls the page sideways on a phone", async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["spending", "cashflow", "balances", "vehicle"]) {
    await page.goto(`/reports?tab=${tab}&p=all`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, tab).toBeLessThanOrEqual(0);
  }
});
