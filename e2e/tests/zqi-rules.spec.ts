import { type Page, expect, test } from "@playwright/test";

// The Rules page (#566): every rule as a sentence with how many transactions
// it decides; a rule a rule above shadows says so; the sheet's preview is a
// dry run; a rule can read and add tags; Move up from ⋯; ▶ applies one rule
// to its transactions; a right click opens the same menu. On a wallet of its
// own, seeded here. Named "zqi-" so it runs after the main journey, whose
// admin it reuses; it also sets itself up when run alone.

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
        title: `Rules ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "bank",
        initialBalance: 100000,
      });
      const fuel = await call("POST", `${base}/categories`, { name: "Fuel" });
      const food = await call("POST", `${base}/categories`, { name: "Food" });
      await call("POST", `${base}/categories`, { name: "Travel" });
      const txn = (memo: string, tags: string[] = []) =>
        call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date: "2026-09-10",
          amount: -5000,
          memo,
          tags,
        });
      const p1 = await txn("Petrol one");
      await txn("Petrol two");
      const hotel = await txn("Hotel", ["trip"]);
      await call("POST", `${base}/assignments`, {
        matchField: "memo",
        matchType: "contains",
        pattern: "petrol",
        setCategoryId: fuel.id,
        setTags: ["car"],
        applyOnManual: true,
        applyOnImport: true,
      });
      await call("POST", `${base}/assignments`, {
        matchField: "memo",
        matchType: "contains",
        pattern: "pet",
        setCategoryId: food.id,
        applyOnManual: true,
        applyOnImport: true,
      });
      return {
        wallet: w.id as number,
        base,
        petrol: p1.id as number,
        hotel: hotel.id as number,
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

const get = (page: Page, url: string) =>
  page.evaluate(async (u) => (await fetch(u)).json(), url);

test("rules: sentences, counts, a dry-run preview, tags, order and apply", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/assignments");
  const table = page.getByTestId("rules-table");
  const rows = table.locator('[data-testid^="rule-row-"]');

  await test.step("each rule reads as a sentence with its count", async () => {
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("When the memo contains");
    await expect(rows.nth(0)).toContainText("file it under Fuel");
    await expect(rows.nth(0)).toContainText("add the tag car");
    await expect(rows.nth(0)).toContainText("2×");
    // "pet" matches both petrols, but the rule above takes them first.
    await expect(rows.nth(1)).toContainText("0×");
    await expect(rows.nth(1)).toContainText("a rule above takes all 2 first");
  });

  await test.step("a new rule on a tag: the preview changes nothing", async () => {
    await page.getByRole("button", { name: "New rule" }).click();
    const sheet = page.getByTestId("rule-sheet");
    await sheet.locator("label", { hasText: /^Tag$/ }).first().click();
    await sheet.getByRole("textbox", { name: "Tag", exact: true }).fill("trip");
    const preview = sheet.getByTestId("rule-preview");
    await expect(preview).toContainText("Matches 1 transaction");
    await expect(preview).toContainText("1 has no category yet");
    await expect(preview).toContainText("Hotel");
    const hotel = await get(page, `${ids.base}/transactions/${ids.hotel}`);
    expect(hotel.categoryId ?? null).toBeNull();

    await sheet.getByRole("combobox", { name: "Category" }).fill("Travel");
    await page.getByRole("option", { name: "Travel" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toBeHidden();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toContainText("When a tag contains");
    await expect(rows.nth(2)).toContainText("1×");
  });

  await test.step("Move up from ⋯ changes the order", async () => {
    await page.getByRole("button", { name: "Actions for rule 3" }).click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await expect(rows.nth(1)).toContainText("When a tag contains");
    await expect
      .poll(async () =>
        (await get(page, `${ids.base}/assignments`)).map(
          (r: { pattern: string }) => r.pattern,
        ),
      )
      .toEqual(["petrol", "trip", "pet"]);
  });

  await test.step("▶ applies one rule to its transactions", async () => {
    await page
      .getByRole("button", { name: "Apply rule 2 to its transactions" })
      .click();
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByText("Updated 1 transaction")).toBeVisible();
    const hotel = await get(page, `${ids.base}/transactions/${ids.hotel}`);
    expect(hotel.categoryId).not.toBeNull();
    // The petrol rule was not applied: its transactions are as they were.
    const petrol = await get(page, `${ids.base}/transactions/${ids.petrol}`);
    expect(petrol.categoryId ?? null).toBeNull();
    expect(petrol.tags).toEqual([]);
  });

  await test.step("a right click opens the rule's menu", async () => {
    await rows.nth(0).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit rule" }).click();
    await expect(page.getByTestId("rule-sheet")).toContainText(
      "Rule 1 of 3, tried first",
    );
    await page.keyboard.press("Escape");
  });

  await test.step("applying every rule adds the tag and keeps the rest", async () => {
    await page.getByRole("button", { name: "Apply to existing" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Apply to existing" })
      .click();
    await expect
      .poll(
        async () =>
          (await get(page, `${ids.base}/transactions/${ids.petrol}`)).tags,
      )
      .toEqual(["car"]);
  });
});
