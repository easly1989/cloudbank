import { expect, test, type Page } from "@playwright/test";

// The figure strip (#503): on a phone, figures that do not fit on one line
// step through a strip, stop at a touch, and never move with reduced motion;
// figures that fit, and every wider screen, stay a plain row. Named "zw-" so
// it runs after the main journey, whose admin it reuses. Its accounts carry
// balances in the millions, so each is deleted afterwards: the overview of the
// shared wallet is left as the later specs expect it.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const made: string[] = [];

test.afterEach(async ({ page }) => {
  while (made.length > 0) {
    const url = made.pop()!;
    await page.evaluate(
      async ({ H, url }) => {
        await fetch(url, { method: "DELETE", headers: H });
      },
      { H, url },
    );
  }
});

/** An account whose three balances are long enough not to fit a phone. */
async function setUp(page: Page, balances: string[]): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const [url, id] = await page.evaluate(
    async ({ H, balances }) => {
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
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({
          preferences: {
            tutorialSeen: true,
            tourOffers: false,
            registerBalances: balances,
          },
        }),
      });
      let wallets = await (await fetch("/api/v1/wallets")).json();
      if (!Array.isArray(wallets) || wallets.length === 0) {
        await fetch("/api/v1/wallets", {
          method: "POST",
          headers: H,
          body: JSON.stringify({ title: "Strip", baseCurrency: "EUR" }),
        });
        wallets = await (await fetch("/api/v1/wallets")).json();
      }
      const w = wallets[0].id;
      const acc = await (
        await fetch(`/api/v1/wallets/${w}/accounts`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({
            name: `Strip ${Date.now()}`,
            type: "bank",
            initialBalance: 1234567890,
          }),
        })
      ).json();
      await fetch(`/api/v1/wallets/${w}/transactions`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          accountId: acc.id,
          date: "2026-01-15",
          amount: 987654321,
          memo: "Big",
        }),
      });
      return [
        `/api/v1/wallets/${w}/accounts/${acc.id}`,
        acc.id as number,
      ] as const;
    },
    { H, balances },
  );
  made.push(url);
  return id;
}

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("three long balances step through the strip and stop at a touch", async ({
    page,
  }) => {
    const id = await setUp(page, ["bank", "today", "future"]);
    await page.goto(`/transactions?account=${id}`);
    const strip = page.locator("[data-ticker]").first();
    await expect(strip).toHaveAttribute("data-moving", "true");
    expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0);
    // One step after four seconds.
    await expect
      .poll(() => strip.evaluate((el) => el.scrollLeft), { timeout: 7000 })
      .toBeGreaterThan(0);
    await strip.dispatchEvent("pointerdown");
    await expect(strip).not.toHaveAttribute("data-moving", /.*/);
  });

  test("one balance fits and stays still", async ({ page }) => {
    const id = await setUp(page, ["bank"]);
    await page.goto(`/transactions?account=${id}`);
    await expect(page.getByText("Reconciled").first()).toBeVisible();
    await expect(page.locator("[data-ticker]")).toHaveCount(0);
  });
});

test.describe("on a phone asking for reduced motion", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });

  test("the strip never moves by itself", async ({ page }) => {
    const id = await setUp(page, ["bank", "today", "future"]);
    await page.goto(`/transactions?account=${id}`);
    const strip = page.locator("[data-ticker]").first();
    await expect(strip).toBeVisible();
    await expect(strip).not.toHaveAttribute("data-moving", /.*/);
  });
});

test("a desktop keeps the figures in a plain row", async ({ page }) => {
  const id = await setUp(page, ["bank", "today", "future"]);
  await page.goto(`/transactions?account=${id}`);
  await expect(page.getByText("Reconciled").first()).toBeVisible();
  await expect(page.locator("[data-ticker]")).toHaveCount(0);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-ticker]")).toHaveCount(0);
});
