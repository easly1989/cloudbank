import { expect, test, type Page } from "@playwright/test";

// Accounts on a phone (#514) and the footer (#513). Named "zx-" so it runs
// after the main journey, whose admin it reuses. The account it makes is
// deleted afterwards and the footer preference put back, so the later specs
// see the shared wallet and the footer as before.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const made: string[] = [];

test.afterEach(async ({ page }) => {
  await page.evaluate(
    async ({ H, made }) => {
      for (const url of made)
        await fetch(url, { method: "DELETE", headers: H });
      const me = await (await fetch("/api/v1/auth/me")).json();
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({
          preferences: { ...me.preferences, showFooter: true },
        }),
      });
    },
    { H, made: made.splice(0) },
  );
});

/** Signs in, and makes an account with a long name and a long balance. */
async function setUp(
  page: Page,
  prefs: Record<string, unknown> = {},
): Promise<string> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const [url, name] = await page.evaluate(
    async ({ H, prefs }) => {
      const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
        .needsSetup as boolean;
      await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
        method: "POST",
        headers: H,
        body: JSON.stringify(
          needsSetup
            ? { username: "admin", email: "a@b.com", password: "supersecret1" }
            : { username: "admin", password: "supersecret1" },
        ),
      });
      const me = await (await fetch("/api/v1/auth/me")).json();
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({
          preferences: {
            ...me.preferences,
            tutorialSeen: true,
            tourOffers: false,
            ...prefs,
          },
        }),
      });
      let wallets = await (await fetch("/api/v1/wallets")).json();
      if (!Array.isArray(wallets) || wallets.length === 0) {
        await fetch("/api/v1/wallets", {
          method: "POST",
          headers: H,
          body: JSON.stringify({ title: "Accounts", baseCurrency: "EUR" }),
        });
        wallets = await (await fetch("/api/v1/wallets")).json();
      }
      const w = wallets[0].id;
      const name = `Carta di credito aziendale ${Date.now()}`;
      const acc = await (
        await fetch(`/api/v1/wallets/${w}/accounts`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({
            name,
            type: "creditcard",
            institution: "Banca Demo",
            initialBalance: -123456789,
          }),
        })
      ).json();
      return [`/api/v1/wallets/${w}/accounts/${acc.id}`, name] as const;
    },
    { H, prefs },
  );
  made.push(url);
  return name;
}

test.describe("on a 320px phone", () => {
  test.use({
    viewport: { width: 320, height: 700 },
    isMobile: true,
    hasTouch: true,
  });

  test("an account is one line, and its actions stay in reach", async ({
    page,
  }) => {
    const name = await setUp(page);
    await page.goto("/accounts");
    const row = page.getByTestId("account-row").filter({ hasText: name });
    await expect(row).toBeVisible();

    // The amount keeps to one line, its symbol with it.
    const amount = row.getByText(/1\D?234\D?567\D89/);
    const box = (await amount.boundingBox())!;
    const lineHeight = await amount.evaluate((el) =>
      parseFloat(getComputedStyle(el).lineHeight),
    );
    expect(box.height).toBeLessThan(lineHeight * 1.5);

    // The ⋯ is inside the screen, and holds Edit and Delete (#564).
    const more = row.getByRole("button", { name: `Actions for ${name}` });
    const moreBox = (await more.boundingBox())!;
    expect(moreBox.x + moreBox.width).toBeLessThanOrEqual(320);
    await more.click();
    await expect(
      page.getByRole("menuitem", { name: "Edit account" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Delete account" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // A tap on the row opens the account's register.
    await row
      .getByRole("button", { name: `Open the register of ${name}` })
      .click();
    await expect(page).toHaveURL(/\/transactions\?account=\d+/);
  });

  test("the footer is one line, and opens to its links", async ({ page }) => {
    await setUp(page);
    await page.goto("/accounts");
    const toggle = page.getByRole("button", { name: "Links" });
    await toggle.scrollIntoViewIfNeeded();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("link", { name: "Source code" })).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const source = page.getByRole("link", { name: "Source code" });
    await expect(source).toBeVisible();
    expect((await source.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("a footer turned off is gone", async ({ page }) => {
    await setUp(page, { showFooter: false });
    await page.goto("/accounts");
    await expect(page.getByRole("button", { name: "Links" })).toHaveCount(0);
  });
});

test("a footer turned off is gone from a desktop, and About keeps the source", async ({
  page,
}) => {
  await setUp(page, { showFooter: false });
  await page.goto("/accounts");
  await expect(
    page.getByText("Accounts", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Source code" })).toHaveCount(0);

  await page.goto("/settings/about");
  await expect(page.getByTestId("about-version")).toBeVisible();
  await expect(page.getByText("AGPL-3.0")).toBeVisible();
  await expect(page.getByRole("link", { name: /Source code/ })).toHaveAttribute(
    "href",
    "https://github.com/easly1989/cloudbank",
  );
});

test("Settings › Appearance turns the footer off", async ({ page }) => {
  await setUp(page);
  await page.goto("/settings/appearance");
  const toggle = page.getByRole("switch", { name: "Show the footer" });
  await toggle.uncheck();
  // The Save of the card the switch is in: the page has more than one.
  await page
    .locator(".mantine-Card-root")
    .filter({ has: toggle })
    .getByRole("button", { name: "Save" })
    .click();
  await expect(page.getByText("Preferences saved").first()).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByRole("link", { name: "Source code" })).toHaveCount(0);
});
