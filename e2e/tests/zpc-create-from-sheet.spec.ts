import { expect, test, type Page } from "@playwright/test";

// A category and a payee are made from the entry sheet itself (#531): typing a
// name that matches nothing offers to create it, the new one is selected, and
// the entry saves with both. A name that exists in another case is not offered
// again — the existing one is.
//
// Named "zpc-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

async function ready(
  page: Page,
  name: string,
): Promise<{ walletId: number; accountId: number }> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(async (name) => {
    const h = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
      .needsSetup as boolean;
    await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify(
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      ),
    });
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({
        preferences: { tutorialSeen: true, tourOffers: false },
      }),
    });
    let wallets = await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ title: "Sheet", baseCurrency: "EUR" }),
      });
      wallets = await (
        await fetch("/api/v1/wallets", { credentials: "same-origin" })
      ).json();
    }
    const acc = await (
      await fetch(`/api/v1/wallets/${wallets[0].id}/accounts`, {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ name, type: "bank" }),
      })
    ).json();
    return { walletId: wallets[0].id as number, accountId: acc.id as number };
  }, name);
}

test("the entry sheet creates a category and a payee, and saves with them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { walletId, accountId } = await ready(page, "Create probe");
  await page.goto(`/transactions?account=${accountId}`);

  const sheet = page.getByRole("dialog");
  await page.getByRole("button", { name: "Add transaction" }).click();
  await sheet.getByLabel("Amount", { exact: true }).fill("3.50");
  await sheet.getByLabel("Date", { exact: true }).fill("2026-03-12");
  await sheet
    .getByLabel("Memo", { exact: true })
    .fill("Espresso at the corner");

  await test.step("a new category is offered, made and selected", async () => {
    const category = sheet.getByRole("combobox", { name: "Category" });
    await category.fill("Espresso probe");
    await page.getByRole("option", { name: "Create “Espresso probe”" }).click();
    await expect(category).toHaveValue("Espresso probe");
  });

  await test.step("a new payee likewise, and its other case is not offered again", async () => {
    await sheet.getByRole("button", { name: "More details" }).click();
    const payee = sheet.getByRole("combobox", { name: "Payee" });
    await payee.fill("Corner bar probe");
    await page.getByRole("option", { name: "Add “Corner bar probe”" }).click();
    await expect(payee).toHaveValue("Corner bar probe");

    await payee.fill("CORNER BAR PROBE");
    await expect(
      page.getByRole("option", { name: "Corner bar probe" }),
    ).toBeVisible();
    await expect(page.getByRole("option", { name: /^Add / })).toHaveCount(0);
    await page.getByRole("option", { name: "Corner bar probe" }).click();
  });

  await test.step("the entry saves with both, the category as an expense", async () => {
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("Espresso at the corner")).toBeVisible();

    const saved = await page.evaluate(
      async ({ walletId, accountId }) => {
        const get = async (path: string) =>
          (
            await fetch(`/api/v1/wallets/${walletId}/${path}`, {
              credentials: "same-origin",
            })
          ).json();
        const [categories, payees, txs] = await Promise.all([
          get("categories"),
          get("payees"),
          get(`transactions?accountId=${accountId}`),
        ]);
        const tx = txs.transactions.find(
          (t: { memo: string }) => t.memo === "Espresso at the corner",
        );
        const cat = categories.find(
          (c: { id: number }) => c.id === tx.categoryId,
        );
        const pay = payees.filter((p: { name: string }) =>
          /corner bar probe/i.test(p.name),
        );
        return {
          category: cat?.name,
          isIncome: cat?.isIncome,
          payees: pay.map((p: { name: string }) => p.name),
          payeeMatches: pay.length === 1 && pay[0].id === tx.payeeId,
        };
      },
      { walletId, accountId },
    );
    expect(saved).toEqual({
      category: "Espresso probe",
      isIncome: false,
      payees: ["Corner bar probe"],
      payeeMatches: true,
    });
  });

  await test.step("on an income, the category made is an income one", async () => {
    await page.getByRole("button", { name: "Add transaction" }).click();
    await sheet.getByLabel("Amount", { exact: true }).fill("+10");
    await sheet
      .getByRole("combobox", { name: "Category" })
      .fill("Refund probe");
    await page.getByRole("option", { name: "Create “Refund probe”" }).click();
    await expect(sheet.getByRole("combobox", { name: "Category" })).toHaveValue(
      "Refund probe",
    );
    const isIncome = await page.evaluate(async (walletId) => {
      const categories = await (
        await fetch(`/api/v1/wallets/${walletId}/categories`, {
          credentials: "same-origin",
        })
      ).json();
      return categories.find((c: { name: string }) => c.name === "Refund probe")
        ?.isIncome;
    }, walletId);
    expect(isIncome).toBe(true);
  });
});
