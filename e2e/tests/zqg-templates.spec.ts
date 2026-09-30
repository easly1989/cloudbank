import { type Page, expect, test } from "@playwright/test";

// The Templates page (#560): the templates kept for quick entry, with how often
// each was used — a transaction saved from one now records it — and the ones a
// schedule posts, which open in Schedules and cannot be deleted from here. The
// sheet keeps a template's tags and info, which the old form wiped on save. On
// a wallet of its own, seeded here. Named "zqg-" so it runs after the main
// journey, whose admin it reuses; it also sets itself up when run alone.

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
        title: `Templates ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 0,
      });
      const food = await call("POST", `${base}/categories`, { name: "Food" });
      const bakery = await call("POST", `${base}/payees`, { name: "Bakery" });
      const landlord = await call("POST", `${base}/payees`, {
        name: "Landlord",
      });
      const bread = await call("POST", `${base}/templates`, {
        name: "Bread",
        accountId: acc.id,
        amount: -350,
        payeeId: bakery.id,
        categoryId: food.id,
        memo: "Loaf",
        tags: ["weekend"],
        info: "cash",
      });
      const rent = await call("POST", `${base}/templates`, {
        name: "Rent",
        accountId: acc.id,
        amount: -75000,
        payeeId: landlord.id,
      });
      const next = new Date(Date.now() + 5 * 86400_000)
        .toISOString()
        .slice(0, 10);
      const schedule = await call("POST", `${base}/schedules`, {
        templateId: rent.id,
        unit: "month",
        everyN: 1,
        nextDue: next,
        autoPost: false,
      });
      return {
        wallet: w.id as number,
        base,
        account: acc.id as number,
        bread: bread.id as number,
        rent: rent.id as number,
        schedule: schedule.id as number,
      };
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

test("templates: two groups, uses counted, the sheet, schedules kept safe", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  const quick = page.getByTestId("templates-quick");
  const scheduled = page.getByTestId("templates-scheduled");
  const breadRow = page.getByTestId(`template-row-${ids.bread}`);

  await test.step("quick-entry and scheduled templates stand apart", async () => {
    await page.goto("/templates");
    await expect(quick).toContainText("Bread");
    await expect(breadRow).toContainText("Bakery");
    await expect(breadRow).toContainText("Never");
    await expect(scheduled).toContainText("Rent");
    await expect(page.getByTestId(`template-row-${ids.rent}`)).toContainText(
      "Every month · next",
    );
  });

  await test.step("a transaction filled in from a template counts as a use", async () => {
    await page.goto(`/transactions?account=${ids.account}`);
    await page.getByRole("button", { name: "Add transaction" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Templates" }).click();
    await page.getByRole("menuitem", { name: "Bread" }).click();
    const memo = sheet.getByLabel("Memo", { exact: true });
    await expect(memo).toHaveValue("Loaf");
    await memo.press("Enter");
    await expect(sheet).toHaveCount(0);

    await page.goto("/templates");
    await expect(breadRow).toContainText("Once");
  });

  await test.step("the sheet keeps the tags and the info", async () => {
    await quick.getByRole("button", { name: "Bread", exact: true }).click();
    const sheet = page.getByTestId("template-sheet");
    await expect(sheet).toContainText("Used once");
    await expect(sheet).toContainText("weekend");
    await expect(sheet.getByLabel("Info / check no.")).toHaveValue("cash");
    await sheet.getByLabel("Memo", { exact: true }).fill("Two loaves");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    const tpl = await page.evaluate(
      async ({ base, id }) =>
        (await (await fetch(`${base}/templates`)).json()).find(
          (t: { id: number }) => t.id === id,
        ),
      { base: ids.base, id: ids.bread },
    );
    expect(tpl).toMatchObject({
      memo: "Two loaves",
      tags: ["weekend"],
      info: "cash",
      amount: -350,
    });
  });

  await test.step("a scheduled template opens its schedule, and is not deleted here", async () => {
    await scheduled.getByRole("button", { name: /Rent/ }).click();
    await expect(page).toHaveURL(new RegExp(`schedule=${ids.schedule}`));
    await expect(page.getByTestId("schedule-sheet")).toBeVisible();
    const status = await page.evaluate(
      async ({ base, id, h }) =>
        (
          await fetch(`${base}/templates/${id}`, {
            method: "DELETE",
            headers: h,
          })
        ).status,
      { base: ids.base, id: ids.rent, h: H },
    );
    expect(status).toBe(409);
  });

  await test.step("a quick template is deleted from its menu", async () => {
    await page.goto("/templates");
    await page.getByRole("button", { name: "Actions for Bread" }).click();
    await page.getByRole("menuitem", { name: "Delete template" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete template" })
      .click();
    await expect(breadRow).toHaveCount(0);
    await expect(scheduled).toContainText("Rent");
  });
});
