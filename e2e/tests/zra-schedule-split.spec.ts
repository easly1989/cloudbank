import { expect, test } from "@playwright/test";

// A schedule whose template is split keeps its lines when it is saved (#562).
// The sheet does not edit them: it says so, locks the amount and the category,
// and sends the lines back as they are — before, a save replaced the template
// without them, and every posting after it came in uncategorised. On a wallet
// of its own; named "zra-" so it runs after the main journey, whose admin it
// reuses, and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("saving a split schedule keeps its lines", async ({ page }) => {
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
        title: `Split schedule ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 0,
      });
      const groceries = await call("POST", `${base}/categories`, {
        name: "Groceries",
      });
      const home = await call("POST", `${base}/categories`, { name: "Home" });
      const tpl = await call("POST", `${base}/templates`, {
        name: "Stock-up",
        accountId: acc.id,
        amount: -12000,
        memo: "Stock-up",
        splits: [
          { categoryId: groceries.id, amount: -9000 },
          { categoryId: home.id, amount: -3000 },
        ],
      });
      const next = new Date(Date.now() + 5 * 86400_000)
        .toISOString()
        .slice(0, 10);
      const s = await call("POST", `${base}/schedules`, {
        templateId: tpl.id,
        unit: "month",
        everyN: 1,
        nextDue: next,
        autoPost: false,
      });
      return {
        wallet: w.id as number,
        base,
        template: tpl.id as number,
        schedule: s.id as number,
      };
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );

  await page.goto(`/schedules?view=list&schedule=${ids.schedule}`);
  const sheet = page.getByTestId("schedule-sheet");

  await test.step("the sheet says it is split and locks the amount and the category", async () => {
    await expect(page.getByTestId("schedule-split-note")).toContainText(
      "split between 2 categories",
    );
    await expect(
      sheet.getByRole("textbox", { name: "Amount", exact: true }),
    ).toBeDisabled();
    await sheet.getByRole("button", { name: "More details" }).click();
    const category = sheet.getByRole("combobox", {
      name: "Category",
      exact: true,
    });
    await expect(category).toBeDisabled();
    await expect(category).toHaveAttribute(
      "placeholder",
      "Split · Groceries, Home",
    );
  });

  await test.step("a save keeps the lines", async () => {
    await sheet
      .getByRole("textbox", { name: "Memo", exact: true })
      .fill("Monthly stock-up");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    const tpl = await page.evaluate(
      async ({ base, id }) =>
        (await (await fetch(`${base}/templates`)).json()).find(
          (t: { id: number }) => t.id === id,
        ),
      { base: ids.base, id: ids.template },
    );
    expect(tpl.isSplit).toBe(true);
    expect(tpl.amount).toBe(-12000);
    expect(tpl.memo).toBe("Monthly stock-up");
    expect((tpl.splits as { amount: number }[]).map((s) => s.amount)).toEqual([
      -9000, -3000,
    ]);
  });
});
