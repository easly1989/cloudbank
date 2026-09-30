import { type Page, expect, test } from "@playwright/test";

// The Currencies page (#558): each currency with its rate against the base,
// where the rate came from and the accounts kept in it; the sheet that edits
// a rate and a format; Delete held back while an account uses a currency; a
// new base that reworks the other rates. On a wallet of its own, seeded here.
// Adding a currency asks the ECB for its rate: the steps hold with or without
// the network (the dirham is not on the ECB's list either way). Named "zqf-"
// so it runs after the main journey, whose admin it reuses; it also sets
// itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

async function seed(page: Page) {
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
        title: `Currencies ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 0,
      });
      const usd = await call("POST", `${base}/currencies`, { isoCode: "USD" });
      // A rate typed by hand, so the figures do not hang on the ECB.
      await call("PATCH", `${base}/currencies/${usd.id}`, { rate: 0.8 });
      await call("POST", `${base}/accounts`, {
        name: "Travel card",
        type: "creditcard",
        currencyId: usd.id,
        initialBalance: 0,
      });
      return { wallet: w.id as number, base };
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

const currency = (page: Page, base: string, code: string) =>
  page.evaluate(
    async ({ base, code }) =>
      (
        (await (await fetch(`${base}/currencies`)).json()) as {
          isoCode: string;
          fracDigits: number;
          rate: number;
        }[]
      ).find((c) => c.isoCode === code),
    { base, code },
  );

test("currencies: rates, the sheet, delete and a new base", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/currencies");
  const table = page.getByTestId("currencies-table");
  const row = (code: string) => page.getByTestId(`currency-row-${code}`);

  await test.step("each currency with its rate, its source and its accounts", async () => {
    await expect(table).toBeVisible();
    await expect(row("EUR")).toContainText("base currency");
    await expect(row("EUR")).toContainText("1 account");
    await expect(row("USD")).toContainText(/0[.,]8000/);
    await expect(row("USD")).toContainText("Typed by you");
    await expect(row("USD")).toContainText("1 account");
  });

  await test.step("a currency an account uses cannot be deleted", async () => {
    await page.getByRole("button", { name: "Actions for US Dollar" }).click();
    await expect(page.getByRole("menuitem", { name: /Delete/ })).toBeDisabled();
    await expect(page.getByRole("menuitem", { name: /Delete/ })).toContainText(
      "Used by 1 account",
    );
    await page.keyboard.press("Escape");
  });

  await test.step("a currency the ECB does not publish asks for its rate", async () => {
    await page.getByRole("button", { name: "Add currency" }).click();
    const sheet = page.getByTestId("currency-sheet");
    await sheet.getByRole("combobox", { name: "Currency" }).fill("AED");
    await page.getByRole("option", { name: /AED/ }).click();
    await sheet.getByRole("button", { name: "Add", exact: true }).click();
    await expect(sheet).toContainText("UAE Dirham", { timeout: 20_000 });
    await expect(page.getByTestId("currency-no-rate")).toContainText(
      "No rate for AED yet",
    );
    await sheet.getByRole("textbox", { name: "Rate" }).fill("0.25");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(row("AED")).toContainText(/0[.,]2500/);
    await expect(row("AED")).toContainText("Typed by you");
  });

  await test.step("the sheet changes how its amounts look", async () => {
    await table
      .getByRole("button", { name: "AED UAE Dirham", exact: true })
      .click();
    const sheet = page.getByTestId("currency-sheet");
    await sheet.getByRole("combobox", { name: "Decimals" }).click();
    await page.getByRole("option", { name: "3", exact: true }).click();
    await expect(page.getByTestId("currency-preview")).toContainText(
      "1,234.560",
    );
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    expect((await currency(page, ids.base, "AED"))?.fracDigits).toBe(3);
    // The rate was not touched, so it was not sent again.
    expect((await currency(page, ids.base, "AED"))?.rate).toBe(0.25);
  });

  await test.step("an unused currency is deleted", async () => {
    await page.getByRole("button", { name: "Actions for UAE Dirham" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(row("AED")).toHaveCount(0);
  });

  await test.step("a new base reworks the other rates", async () => {
    await page.getByRole("button", { name: "Actions for US Dollar" }).click();
    await page
      .getByRole("menuitem", { name: "Make it the base currency" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Make it the base currency" })
      .click();
    await expect(row("USD")).toContainText("base currency");
    await expect(row("EUR")).not.toContainText("base currency");
    // 1 € now reads in dollars, whether worked out (1.25) or fetched.
    await expect(row("EUR")).toContainText(/€.*=.*\$/);
    const eur = await currency(page, ids.base, "EUR");
    expect(eur?.rate).toBeGreaterThan(1);
  });
});
