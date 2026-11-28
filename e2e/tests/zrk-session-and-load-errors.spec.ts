import { expect, test, type Page } from "@playwright/test";

// What a page shows when its data does not come (#804). An ended session went
// on showing an empty register and "0,00 €" spent; a failed query drew the
// same zeros. Now the first goes back to sign-in and then to the same page,
// and the second shows the page's error, or the widget's on the dashboard.
// On a wallet of its own; named "zrk-" so it runs after the main journey,
// whose admin it reuses, and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// Signs in through the API and opens a wallet of its own with one account.
async function signIn(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const wallet = await page.evaluate(async (h) => {
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
      title: `Errors ${Date.now()}`,
      baseCurrency: "EUR",
    });
    await call("POST", `/api/v1/wallets/${w.id}/accounts`, {
      name: "Checking",
      type: "bank",
      initialBalance: 100000,
    });
    return w.id as number;
  }, H);
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    wallet,
  );
}

const failBudgetReport = (page: Page) =>
  page.route("**/api/v1/wallets/*/budgets/report*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "internal", message: "boom" } }),
    }),
  );

test("an ended session goes to sign-in, then back to the same page", async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.goto("/budget");
  await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();

  // The session ends behind the page's back.
  await context.clearCookies();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();

  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Username").fill("admin");
  await page.locator('input[type="password"]').fill("supersecret1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
});

test("a page whose data fails to load says so, never zero", async ({
  page,
}) => {
  await signIn(page);
  await failBudgetReport(page);
  await page.goto("/budget");
  await expect(
    page.getByRole("heading", { name: "This page could not load its data" }),
  ).toBeVisible();
  // Moving on clears it: the next page loads as usual.
  await page.unrouteAll();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "This page could not load its data" }),
  ).toBeHidden();
});

test("a dashboard widget whose data fails says so in its own card", async ({
  page,
}) => {
  await signIn(page);
  await failBudgetReport(page);
  await page.goto("/");
  // The budget widget, and the things-to-look-at strip, which reads it too.
  await expect(
    page.getByText("This widget could not load its data.").first(),
  ).toBeVisible();
  // The rest of the dashboard is still there.
  await expect(
    page.getByRole("heading", { name: "This page could not load its data" }),
  ).toBeHidden();
  await expect(page.getByText("Checking").first()).toBeVisible();

  // Once the data comes, Try again brings the widget back.
  await page.unrouteAll();
  const retry = page.getByRole("button", { name: "Try again" });
  while ((await retry.count()) > 0) await retry.first().click();
  await expect(
    page.getByText("This widget could not load its data."),
  ).toHaveCount(0);
});
