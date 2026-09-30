import { type Page, expect, test } from "@playwright/test";

// The Accounts page (#564): each account's reconciled, today and future
// balance, a band per type and the total in the base currency; a click that
// opens the register; the sheet that keeps what the old dialog wiped (the
// budget and report exclusions, the notes, the group, the website); Reconcile
// from the ⋯. On a wallet of its own, seeded here. Named "zqh-" so it runs
// after the main journey, whose admin it reuses; it also sets itself up when
// run alone.

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
        title: `Accounts ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const usd = await call("POST", `${base}/currencies`, { isoCode: "USD" });
      // A rate typed by hand, so the total does not hang on the ECB.
      await call("PATCH", `${base}/currencies/${usd.id}`, { rate: 0.8 });
      const checking = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "bank",
        institution: "Demo Bank",
        initialBalance: 100000,
        minimumBalance: 80000,
        groupName: "Main",
        website: "https://bank.example",
      });
      await call("POST", `${base}/accounts`, {
        name: "Card",
        type: "creditcard",
        initialBalance: -30000,
      });
      await call("POST", `${base}/accounts`, {
        name: "Travel",
        type: "bank",
        currencyId: usd.id,
        initialBalance: 10000,
      });
      await call("POST", `${base}/accounts`, {
        name: "Old savings",
        type: "savings",
        initialBalance: 5000,
        closed: true,
      });
      const day = (offset: number) =>
        new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
      const txn = (date: string, amount: number, status: number) =>
        call("POST", `${base}/transactions`, {
          accountId: checking.id,
          date,
          amount,
          status,
        });
      await txn(day(-20), -20000, 2); // reconciled
      await txn(day(-1), -5000, 0); // entered since
      await txn(day(10), -10000, 0); // dated ahead
      return { wallet: w.id as number, base, checking: checking.id as number };
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

test("accounts: three balances, the register, the sheet and reconcile", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/accounts");
  const table = page.getByTestId("accounts-table");
  const row = page.getByTestId(`account-row-${ids.checking}`);

  await test.step("reconciled, today and future, a band per type and the total", async () => {
    await expect(table).toBeVisible();
    // 1.000 − 200 reconciled; − 50 entered since; − 100 dated ahead.
    await expect(row).toContainText(/800[.,]00/);
    await expect(row).toContainText(/750[.,]00/);
    await expect(row).toContainText(/650[.,]00/);
    await expect(row).toContainText("reconciled");
    await expect(row).toContainText("under the");
    // The card is negative with no minimum set: no warning.
    await expect(table.getByText("Card", { exact: true })).toBeVisible();
    await expect(page.getByTestId("accounts-group-creditcard")).toBeVisible();
    // Today: 750 − 300 + 100 $ at 0.80 = 530 €, three accounts counted.
    const total = page.getByTestId("accounts-total");
    await expect(total).toContainText("3 accounts");
    await expect(total).toContainText(/530[.,]00/);
    await expect(page.getByText("Totals are in EUR")).toBeVisible();
  });

  await test.step("a closed account shows only on request", async () => {
    await expect(table).not.toContainText("Old savings");
    await page.getByRole("button", { name: /Closed/ }).click();
    await expect(table).toContainText("Old savings");
    await expect(page.getByTestId("accounts-total")).toContainText(
      "3 accounts",
    );
  });

  await test.step("the sheet keeps what the old dialog wiped", async () => {
    await page.getByRole("button", { name: "Actions for Checking" }).click();
    await page.getByRole("menuitem", { name: "Edit account" }).click();
    const sheet = page.getByTestId("account-sheet");
    await expect(sheet.getByTestId("account-figures")).toContainText(
      /800[.,]00/,
    );
    await sheet.getByLabel("The budget").check();
    await sheet.getByLabel("Notes", { exact: true }).fill("Salary lands here");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    const acc = await page.evaluate(
      async ({ base, id }) =>
        (await (await fetch(`${base}/accounts`)).json()).find(
          (a: { id: number }) => a.id === id,
        ),
      { base: ids.base, id: ids.checking },
    );
    expect(acc).toMatchObject({
      noBudget: true,
      noSummary: false,
      notes: "Salary lands here",
      groupName: "Main",
      website: "https://bank.example",
      minimumBalance: 80000,
    });
  });

  await test.step("Reconcile opens the register reconciling", async () => {
    await page.getByRole("button", { name: "Actions for Checking" }).click();
    await page.getByRole("menuitem", { name: "Reconcile" }).click();
    await expect(page).toHaveURL(/reconcile=1/);
    await expect(page.getByLabel("Statement balance")).toBeVisible();
  });

  await test.step("a click on the row opens the register", async () => {
    await page.goto("/accounts");
    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`/transactions\\?account=${ids.checking}$`),
    );
  });
});
