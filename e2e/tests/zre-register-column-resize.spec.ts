import { expect, test } from "@playwright/test";

// Widening a register column (Transactions) keeps the new width: on screen
// once the drag ends, and after a reload, since widths are a preference. The
// drag once saved nothing and put every column back the moment it was let go.
// On a wallet of its own; named "zre-" so it runs after the main journey,
// whose admin it reuses, and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 900 } });

// A wallet of its own with one account and one transaction, opened on the
// register, with the admin's column preferences back to their defaults.
async function openRegister(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(async (h) => {
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
    const prefs = { ...(me.preferences ?? {}) };
    delete prefs.registerColumnWidths;
    delete prefs.registerColumnOrder;
    delete prefs.registerColumns;
    await call("PATCH", "/api/v1/auth/me", {
      preferences: { ...prefs, tutorialSeen: true, tourOffers: false },
    });
    const w = await call("POST", "/api/v1/wallets", {
      title: `Widths ${Date.now()}`,
      baseCurrency: "EUR",
    });
    const base = `/api/v1/wallets/${w.id}`;
    const acc = await call("POST", `${base}/accounts`, {
      name: "Checking",
      type: "bank",
      initialBalance: 100000,
    });
    await call("POST", `${base}/transactions`, {
      accountId: acc.id,
      date: new Date().toISOString().slice(0, 10),
      amount: -1250,
      memo: "Coffee beans",
    });
    return { wallet: w.id as number, account: acc.id as number };
  }, H);
  await page.evaluate((id) => {
    localStorage.setItem("cb.currentWalletId", String(id));
  }, ids.wallet);
  await page.goto(`/transactions?account=${ids.account}`);
  await expect(page.getByText("Coffee beans")).toBeVisible();
}

// The signed-in user's stored preferences, as the server has them.
const storedPrefs = (page: import("@playwright/test").Page) =>
  page.evaluate(async (h) => {
    const r = await fetch("/api/v1/auth/me", { headers: h });
    return (await r.json()).preferences as {
      registerColumnOrder?: string[];
      registerColumns?: Record<string, boolean>;
    };
  }, H);

test("a widened register column keeps its width, then and after a reload", async ({
  page,
}) => {
  await openRegister(page);

  const grip = page.getByRole("separator", { name: /column's width/ }).first();
  const header = grip.locator("..");
  const before = (await header.boundingBox())!.width;

  await test.step("the column is as wide as it was dragged, once let go", async () => {
    const g = (await grip.boundingBox())!;
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/auth/me") && r.request().method() === "PATCH",
    );
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2 + 60, g.y + g.height / 2, {
      steps: 4,
    });
    await page.mouse.move(g.x + g.width / 2 + 120, g.y + g.height / 2, {
      steps: 4,
    });
    await page.mouse.up();
    expect((await saved).ok()).toBe(true);
    await expect
      .poll(async () => (await header.boundingBox())!.width)
      .toBeGreaterThan(before + 100);
  });

  await test.step("and after a reload", async () => {
    await page.reload();
    await expect(page.getByText("Coffee beans")).toBeVisible();
    const again = page
      .getByRole("separator", { name: /column's width/ })
      .first()
      .locator("..");
    await expect
      .poll(async () => (await again.boundingBox())!.width)
      .toBeGreaterThan(before + 100);
  });
});

test("hiding and moving register columns is kept, even when clicked quickly", async ({
  page,
}) => {
  await openRegister(page);
  await page.getByRole("button", { name: "Columns" }).click();

  await test.step("two quick moves are two moves", async () => {
    // From the default order (date, payee, category, …), Category two places
    // to the right is fourth.
    const right = page.getByRole("button", { name: "Move Category right" });
    // A server some way off: the second click lands before the first save
    // has answered.
    await page.route("**/api/v1/auth/me", async (route) => {
      if (route.request().method() === "PATCH")
        await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await right.click();
    await right.click();
    await expect
      .poll(async () =>
        (await storedPrefs(page)).registerColumnOrder?.indexOf("category"),
      )
      .toBe(4);
    await page.waitForLoadState("networkidle");
    expect(
      (await storedPrefs(page)).registerColumnOrder?.indexOf("category"),
    ).toBe(4);
  });

  await test.step("a hidden column stays hidden after a reload", async () => {
    await page.getByRole("checkbox", { name: "Category" }).click();
    await expect
      .poll(async () => (await storedPrefs(page)).registerColumns?.category)
      .toBe(false);
    await page.reload();
    await page.getByRole("button", { name: "Columns" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Category" }),
    ).not.toBeChecked();
  });

  await test.step("Reset brings the defaults back", async () => {
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Category" }),
    ).toBeChecked();
    await expect
      .poll(async () => (await storedPrefs(page)).registerColumns?.category)
      .toBe(true);
  });
});
