import { type Page, expect, test } from "@playwright/test";

// The Tags page (#556): each tag with what it held over the last twelve months
// and the categories it was mostly in; Add, which makes a tag before any
// transaction has it; the sheet that renames one; merging from a row. On a
// wallet of its own, seeded here, so the figures are known. Named "zqe-" so it
// runs after the main journey, whose admin it reuses; it also sets itself up
// when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const twoYearsAgo = `${now.getFullYear() - 2}-12-19`;

test.use({ viewport: { width: 1440, height: 1000 } });

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, today, twoYearsAgo }) => {
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
        title: `Tags ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
        initialBalance: 100000,
      });
      const fuel = (await call("POST", `${base}/categories`, { name: "Fuel" }))
        .id;
      const gifts = (
        await call("POST", `${base}/categories`, { name: "Gifts" })
      ).id;
      const txn = (
        date: string,
        amount: number,
        categoryId: number,
        tag: string,
      ) =>
        call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date,
          amount,
          categoryId,
          tags: [tag],
        });
      await txn(today, -3000, fuel, "car");
      await txn(today, -2000, fuel, "car");
      // Used long ago: in the list, with nothing in the period.
      await txn(twoYearsAgo, -1500, gifts, "christmas");
      // Made here, on no transaction at all.
      await call("POST", `${base}/tags`, { name: "idle" });
      return { wallet: w.id as number, base };
    },
    { h: H, today, twoYearsAgo },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

const tagNames = (page: Page, base: string) =>
  page.evaluate(
    async (base) =>
      (
        (await (await fetch(`${base}/tags/manage`)).json()) as {
          name: string;
          count: number;
        }[]
      )
        .map((t) => `${t.name} ${t.count}`)
        .sort(),
    base,
  );

test("tags: figures, add, rename and merge", async ({ page }) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/tags");
  const table = page.getByTestId("tags-table");
  const rows = table.locator('[data-testid^="tag-row-"]');

  await test.step("each tag with its figures, the largest amount first", async () => {
    await expect(table).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("car");
    await expect(rows.nth(0)).toContainText("Fuel 2");
    await expect(rows.nth(0)).toContainText(/-50[.,]00/);
    await expect(rows.nth(1)).toContainText("christmas");
    await expect(rows.nth(2)).toContainText("idle");
    await expect(rows.nth(2)).toContainText("Never");
  });

  await test.step("a header sorts by its column", async () => {
    await table.getByRole("button", { name: "Sort by Tag" }).click();
    await expect(rows.first()).toContainText("car");
    await table.getByRole("button", { name: /^Tag, sorted/ }).click();
    await expect(rows.first()).toContainText("idle");
  });

  await test.step("the filters", async () => {
    await page.getByRole("button", { name: /Unused in 12 months/ }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: /Unused in 12 months/ }).click();
    await page.getByPlaceholder("Find a tag").fill("chr");
    await expect(rows).toHaveCount(1);
    await page.getByPlaceholder("Find a tag").fill("");
  });

  await test.step("Add makes a tag, and refuses one that exists", async () => {
    await page.getByRole("button", { name: "Add tag" }).click();
    const sheet = page.getByTestId("tag-sheet");
    const name = sheet.getByRole("textbox", { name: "Name" });
    await name.fill("car");
    await expect(sheet).toContainText("already exists");
    await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
    await name.fill("reimbursable");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(rows).toHaveCount(4);
    expect(await tagNames(page, ids.base)).toContain("reimbursable 0");
  });

  await test.step("the sheet shows its year and renames it everywhere", async () => {
    await table.getByRole("button", { name: "car", exact: true }).click();
    const sheet = page.getByTestId("tag-sheet");
    const usage = page.getByTestId("tag-usage");
    await expect(usage).toContainText("2 transactions");
    await expect(usage).toContainText("Fuel");
    await expect(
      sheet.getByRole("link", { name: "See it in the reports" }),
    ).toHaveAttribute("href", "/reports?tg=car&p=year");
    await sheet.getByRole("textbox", { name: "Name" }).fill("auto");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    expect(await tagNames(page, ids.base)).toContain("auto 2");
  });

  await test.step("merging one tag into another", async () => {
    await page.getByRole("button", { name: "Actions for christmas" }).click();
    await page.getByRole("menuitem", { name: "Merge" }).click();
    const dialog = page.getByRole("dialog", { name: "Merge tag" });
    await dialog.getByRole("combobox").click();
    await page.getByRole("option", { name: "auto" }).click();
    await dialog.getByRole("button", { name: "Merge" }).click();
    await expect(dialog).toBeHidden();
    await expect(rows).toHaveCount(3);
    expect(await tagNames(page, ids.base)).toEqual([
      "auto 3",
      "idle 0",
      "reimbursable 0",
    ]);
  });
});
