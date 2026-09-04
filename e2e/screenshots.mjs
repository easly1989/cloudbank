// Generates the documentation screenshots from a running CloudBank instance.
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node screenshots.mjs
//
// Output PNGs land in ../docs/img. The run is self-contained: it does first-run
// setup, imports the sample .xhb for realistic data, dismisses the first-login
// tour, then captures each screen.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CB_BASE_URL ?? "http://localhost:8080";
const OUT = resolve(__dirname, "../docs/img");
const FIXTURE = resolve(__dirname, "fixtures/sample.xhb");

const VIEWPORT = { width: 1320, height: 860 };

async function shoot(page, name) {
  await page.waitForTimeout(450); // let charts/animations settle
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log("captured", name);
}

// CB_CHROME lets a caller point at a preinstalled Chromium (e.g. a sandbox where
// `playwright install` is unavailable); otherwise Playwright's own browser is used.
const browser = await chromium.launch({ executablePath: process.env.CB_CHROME || undefined });
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1.5,
  colorScheme: "light",
});
const page = await ctx.newPage();

try {
  // First-run setup.
  await page.goto(BASE);
  await page.getByLabel("Username").fill("demo");
  const pw = page.locator('input[type="password"]');
  await pw.first().fill("demodemo123");
  await pw.nth(1).fill("demodemo123");
  await page.getByRole("button", { name: "Create admin account" }).click();

  // First wallet, then import the sample for realistic data.
  await page.getByLabel("Wallet name").fill("Demo");
  await page.getByRole("button", { name: "Create wallet" }).click();
  await page.getByRole("button", { name: "Test Wallet" }).or(page.getByRole("button", { name: "Demo" })).first().waitFor();

  // The first-login tour auto-runs; skip it before capturing.
  await page.getByRole("button", { name: "Skip" }).click();

  // Import now lives under Settings → wallet tab → "Import & export" section.
  await page.goto(BASE + "/settings?tab=wallet&section=import");
  await page.setInputFiles('input[type="file"]', FIXTURE);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText("Import complete").waitFor();

  // Dashboard (imported wallet is now active).
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await shoot(page, "dashboard");

  // Dashboard customise mode (the dashboard button, not the sidebar's).
  await page.locator('[data-tour="customize"]').click();
  await shoot(page, "dashboard-customize");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // Register / transactions.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.waitForTimeout(400);
  await shoot(page, "register");

  // Register with a multi-selection so the bulk-action bar is visible.
  try {
    const boxes = page.locator('[aria-label="Select row"]');
    const n = Math.min(await boxes.count(), 4);
    for (let i = 0; i < n; i++) await boxes.nth(i).click();
    await page.waitForTimeout(300);
    await shoot(page, "register-bulk");
    for (let i = 0; i < n; i++) await boxes.nth(i).click(); // clear selection
  } catch {
    /* selection is best-effort */
  }

  // Bills — one row per bill (last payment + next occurrence).
  await page.goto(BASE + "/bills");
  await page.waitForTimeout(500);
  await shoot(page, "bills");

  // Seed a look-alike pair so the Review page's duplicate finder has content.
  await page.evaluate(async () => {
    const hdr = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
    const wallets = await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json();
    let wid, acc;
    for (const w of wallets) {
      const as = await (
        await fetch(`/api/v1/wallets/${w.id}/accounts`, { credentials: "same-origin" })
      ).json();
      if (as.length) {
        wid = w.id;
        acc = as[0].id;
        break;
      }
    }
    const post = (body) =>
      fetch(`/api/v1/wallets/${wid}/transactions`, {
        method: "POST",
        credentials: "same-origin",
        headers: hdr,
        body: JSON.stringify({ accountId: acc, ...body }),
      });
    await post({ date: "2026-02-10", amount: -4200, memo: "Gym membership" });
    await post({ date: "2026-02-13", amount: -4200, memo: "GYM CLUB MONTHLY" });
  });

  // Bank-sync review — uncategorized imports + duplicate finder.
  await page.goto(BASE + "/review");
  await page.waitForTimeout(700);
  await shoot(page, "review");

  // Reports — Statistics.
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  await page.getByRole("tab", { name: "Statistics" }).waitFor();
  await page.locator("canvas").first().waitFor();
  await shoot(page, "reports");

  // Templates.
  await page.getByRole("link", { name: "Templates", exact: true }).click();
  await page.waitForTimeout(300);
  await shoot(page, "templates");

  // Settings — preferences (theme + accent picker).
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.waitForTimeout(300);
  await shoot(page, "settings");

  // Wallet settings — backup / .xhb export. The wallet tab is titled after the
  // active wallet, so deep-link to its backup section instead of clicking a tab.
  await page.goto(BASE + "/settings?tab=wallet&section=backup");
  await page.waitForTimeout(400);
  await shoot(page, "export");

  console.log("\nAll screenshots written to", OUT);
} finally {
  await browser.close();
}
