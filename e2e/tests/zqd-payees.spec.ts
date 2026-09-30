import { type Page, expect, test } from "@playwright/test";

// The Payees page (#554): each payee with what it held over the last twelve
// months and the category it usually gets, which one click makes its default;
// the sheet that edits one, and keeps its default payment. On a wallet of its
// own, seeded here, so the figures are known. Named "zqd-" so it runs after
// the main journey, whose admin it reuses; it also sets itself up when run
// alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

test.use({ viewport: { width: 1440, height: 1000 } });

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, today }) => {
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
        title: `Payees ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 100000,
      });
      const groceries = (
        await call("POST", `${base}/categories`, { name: "Groceries" })
      ).id;
      const rent = (await call("POST", `${base}/categories`, { name: "Rent" }))
        .id;
      const payee = async (name: string, extra = {}) =>
        (await call("POST", `${base}/payees`, { name, ...extra })).id as number;
      const shop = await payee("Supermarket");
      // A default payment the page never showed, and used to wipe on save.
      const landlord = await payee("Landlord", {
        defaultCategoryId: rent,
        defaultPaymentMode: 7,
      });
      const idle = await payee("Idle");
      const txn = (
        payeeId: number,
        amount: number,
        categoryId: number,
        paymentMode: number,
      ) =>
        call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date: today,
          amount,
          payeeId,
          categoryId,
          paymentMode,
        });
      await txn(shop, -3000, groceries, 6);
      await txn(shop, -2000, groceries, 6);
      await txn(landlord, -50000, rent, 7);
      return { wallet: w.id as number, base, shop, landlord, idle, groceries };
    },
    { h: H, today },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

const payee = (page: Page, base: string, id: number) =>
  page.evaluate(
    async ({ base, id }) =>
      ((await (await fetch(`${base}/payees`)).json()) as { id: number }[]).find(
        (p) => p.id === id,
      ),
    { base, id },
  );

test("payees: figures, the usual category and the sheet", async ({ page }) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/payees");
  const table = page.getByTestId("payees-table");

  await test.step("each payee with its figures, the largest amount first", async () => {
    await expect(table).toBeVisible();
    const rows = table.locator('[data-testid^="payee-row-"]');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("Landlord");
    await expect(rows.nth(0)).toContainText("Rent");
    await expect(rows.nth(1)).toContainText("Supermarket");
    await expect(rows.nth(1)).toContainText("Usually Groceries");
    await expect(rows.nth(1)).toContainText(/-50[.,]00/);
    await expect(rows.nth(2)).toContainText("Never");
  });

  await test.step("a header sorts by its column", async () => {
    await table.getByRole("button", { name: "Sort by Payee" }).click();
    await expect(
      table.locator('[data-testid^="payee-row-"]').first(),
    ).toContainText("Idle");
    await table.getByRole("button", { name: /^Payee, sorted/ }).click();
    await expect(
      table.locator('[data-testid^="payee-row-"]').first(),
    ).toContainText("Supermarket");
  });

  await test.step("the filters", async () => {
    await page.getByRole("button", { name: /No default category/ }).click();
    await expect(table.getByText("Landlord")).toHaveCount(0);
    await page.getByRole("button", { name: /No default category/ }).click();
    await page.getByRole("button", { name: /Unused in 12 months/ }).click();
    await expect(table.locator('[data-testid^="payee-row-"]')).toHaveCount(1);
    await page.getByRole("button", { name: /Unused in 12 months/ }).click();
    await page.getByPlaceholder("Find a payee").fill("super");
    await expect(table.locator('[data-testid^="payee-row-"]')).toHaveCount(1);
    await page.getByPlaceholder("Find a payee").fill("");
  });

  await test.step("Use it makes the usual category the default", async () => {
    const row = page.getByTestId(`payee-row-${ids.shop}`);
    await row.hover();
    await row
      .getByRole("button", {
        name: "Use Groceries as the default for Supermarket",
      })
      .click();
    await expect(row).not.toContainText("Usually");
    await expect(row).toContainText("Groceries");
    expect((await payee(page, ids.base, ids.shop))?.defaultCategoryId).toBe(
      ids.groceries,
    );
  });

  await test.step("the sheet offers the usual payment and keeps it", async () => {
    await table
      .getByRole("button", { name: "Supermarket", exact: true })
      .click();
    const sheet = page.getByTestId("payee-sheet");
    await expect(page.getByTestId("payee-usage")).toContainText(
      "2 transactions",
    );
    await expect(
      sheet.getByRole("link", { name: "See it in the reports" }),
    ).toHaveAttribute("href", `/reports?pe=${ids.shop}&p=year`);
    await expect(sheet).toContainText("It is usually paid by Debit card.");
    await sheet.getByRole("button", { name: "Use it" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    expect((await payee(page, ids.base, ids.shop))?.defaultPaymentMode).toBe(6);
  });

  await test.step("renaming a payee keeps its default payment", async () => {
    await table.getByRole("button", { name: "Landlord", exact: true }).click();
    const sheet = page.getByTestId("payee-sheet");
    await sheet.getByRole("textbox", { name: "Name" }).fill("Landlady");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    const p = (await payee(page, ids.base, ids.landlord)) as
      { name: string; defaultPaymentMode?: number } | undefined;
    expect(p?.name).toBe("Landlady");
    expect(p?.defaultPaymentMode).toBe(7);
  });
});
