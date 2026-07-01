import { expect, test, type Page } from "@playwright/test";

// Mobile/responsive checks. Named "zz-" so it runs after the main journey
// (smoke.spec.ts), whose admin it reuses; it also self-sets-up when run alone.
// Verifies: no horizontal overflow on the key pages across phone/tablet
// widths, and the navigation drawer closes after selecting a destination.

const VIEWPORTS = [
  { label: "small-phone", width: 320, height: 568 },
  { label: "phone", width: 390, height: 844 },
  { label: "tablet", width: 768, height: 1024 },
];

const PAGES = ["/", "/accounts", "/transactions", "/reports", "/budget", "/settings"];

// ensureReady authenticates (setting up the admin on a fresh instance, else
// logging in) and makes sure a wallet exists, all via the same-origin API so
// the cookie lands in the page context. Then it navigates home.
async function ensureReady(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    const h = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json()).needsSetup as boolean;
    if (needsSetup) {
      await fetch("/api/v1/setup", {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ username: "admin", email: "a@b.com", password: "supersecret1" }),
      });
    } else {
      await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ username: "admin", password: "supersecret1" }),
      });
    }
    // Suppress the first-login tour so its backdrop never blocks the layout.
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({ preferences: { tutorialSeen: true } }),
    });
    const wallets = await (await fetch("/api/v1/wallets", { credentials: "same-origin" })).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ title: "Mobile", baseCurrency: "EUR" }),
      });
    }
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`responsive @ ${vp.label} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("no page has horizontal overflow", async ({ page }) => {
      await ensureReady(page);
      for (const path of PAGES) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(300);
        const overflow = await horizontalOverflow(page);
        expect(overflow, `${path} overflows by ${overflow}px at ${vp.width}px`).toBeLessThanOrEqual(
          1,
        );
      }
      await page.goto("/transactions");
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `test-results/responsive-${vp.label}-register.png` });
    });
  });
}

test.describe("mobile navigation drawer", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("closes after selecting a destination", async ({ page }) => {
    await ensureReady(page);
    const navbar = page.locator(".mantine-AppShell-navbar").first();

    // The drawer starts off-screen (negative x) on a phone-width viewport.
    expect((await navbar.boundingBox())?.x ?? 0).toBeLessThan(0);

    // Open it with the burger; it slides on-screen (x ~ 0).
    await page.locator(".mantine-Burger-root").first().click();
    await expect.poll(async () => (await navbar.boundingBox())?.x ?? -999).toBeGreaterThan(-5);

    // Selecting a destination navigates AND closes the drawer.
    await page.getByRole("link", { name: "Settings", exact: true }).first().click();
    await expect(page).toHaveURL(/\/settings/);
    await expect.poll(async () => (await navbar.boundingBox())?.x ?? 0).toBeLessThan(0);
  });
});
