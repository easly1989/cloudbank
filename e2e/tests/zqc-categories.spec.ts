import { type Page, expect, test } from "@playwright/test";

// The Categories page (#552): each category with what it held over the last
// twelve months, as rows or as an index, and the sheet that edits one, moving
// a subcategory between groups included. On a wallet of its own, seeded here,
// so the figures are known. Named "zqc-" so it runs after the main journey,
// whose admin it reuses; it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const longAgo = `${now.getFullYear() - 2}-06-15`;

// Mantine's segmented control hides its radios: the label is what takes a click.
const segment = (page: Page, name: string) =>
  page.locator("label", { hasText: new RegExp(`^${name}`) });

test.use({ viewport: { width: 1440, height: 1000 } });

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, today, longAgo }) => {
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
      const { categoriesView: _v, ...rest } = me.preferences ?? {};
      await call("PATCH", "/api/v1/auth/me", {
        preferences: { ...rest, tutorialSeen: true, tourOffers: false },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Categories ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 100000,
      });
      const cat = async (name: string, parentId?: number, isIncome = false) =>
        (await call("POST", `${base}/categories`, { name, parentId, isIncome }))
          .id as number;
      const food = await cat("Food");
      const groceries = await cat("Groceries", food);
      const dining = await cat("Dining out", food);
      const home = await cat("Home");
      const pay = await cat("Pay", undefined, true);
      const txn = (date: string, amount: number, categoryId: number) =>
        call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date,
          amount,
          categoryId,
        });
      await txn(today, -3000, groceries);
      await txn(today, -2000, groceries);
      await txn(today, -50000, home);
      await txn(today, 250000, pay);
      // Used, but not in the last twelve months.
      await txn(longAgo, -1500, dining);
      return { wallet: w.id as number, food, groceries, home };
    },
    { h: H, today, longAgo },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

test("categories: figures, views and moving a subcategory", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/categories");
  const rows = page.getByTestId("categories-rows");

  await test.step("rows: each group with its subcategories and their figures", async () => {
    await expect(rows).toBeVisible();
    const food = page.getByTestId(`category-group-${ids.food}`);
    await expect(food).toContainText("Groceries");
    await expect(food).toContainText(/-50[.,]00/);
    await expect(food).toContainText(/Not used since/);
    // Home is the larger group, so it comes first.
    await expect(
      rows.locator('[data-testid^="category-group-"]').first(),
    ).toContainText("Home");
    // One unused category: Dining out.
    await expect(
      page.getByRole("button", { name: /Unused in 12 months/ }),
    ).toContainText("1");
  });

  await test.step("a group folds away its subcategories", async () => {
    await page
      .getByRole("button", { name: "Hide the subcategories of Food" })
      .click();
    await expect(rows.getByText("Groceries")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Show the subcategories of Food" })
      .click();
    await expect(rows.getByText("Groceries")).toBeVisible();
  });

  await test.step("search and the unused filter", async () => {
    await page.getByPlaceholder("Find a category").fill("groc");
    await expect(rows.getByText("Groceries")).toBeVisible();
    await expect(rows.getByText("Home")).toHaveCount(0);
    await page.getByPlaceholder("Find a category").fill("");
    await page.getByRole("button", { name: /Unused in 12 months/ }).click();
    await expect(rows.getByText("Dining out")).toBeVisible();
    await expect(rows.getByText("Groceries")).toHaveCount(0);
    await page.getByRole("button", { name: /Unused in 12 months/ }).click();
  });

  await test.step("the sheet shows its use and moves it to another group", async () => {
    await rows.getByRole("button", { name: "Groceries", exact: true }).click();
    const sheet = page.getByTestId("category-sheet");
    await expect(sheet).toContainText("Spending, in Food");
    await expect(page.getByTestId("category-usage")).toContainText(/-50[.,]00/);
    await expect(page.getByTestId("category-usage")).toContainText(
      "2 transactions",
    );
    await expect(
      sheet.getByRole("link", { name: "See it in the reports" }),
    ).toHaveAttribute("href", `/reports?cat=${ids.groceries}&p=year`);
    await sheet.getByRole("combobox", { name: "Group" }).click();
    await page.getByRole("option", { name: "Home" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByTestId(`category-group-${ids.home}`)).toContainText(
      "Groceries",
    );
    await expect(
      page.getByTestId(`category-group-${ids.food}`),
    ).not.toContainText("Groceries");
  });

  await test.step("the index view is kept with the preferences", async () => {
    await segment(page, "Index").click();
    await expect(page.getByTestId("categories-index")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("categories-index")).toBeVisible();
    await segment(page, "Rows").click();
    await expect(rows).toBeVisible();
    await page.reload();
    await expect(rows).toBeVisible();
  });
});
