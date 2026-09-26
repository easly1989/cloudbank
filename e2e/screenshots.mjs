// Generates the documentation screenshots from a running CloudBank instance.
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node screenshots.mjs
//
// Output PNGs land in ../docs/img. The run is self-contained: it does first-run
// setup, loads data, turns the page-tour offers off, then captures each screen.
//
// The data. With CB_DEMO_URL pointing at a running `:demo` build, the run starts
// a demo session there and brings its wallet over through a wallet backup: a
// year of made-up transactions, budgets and schedules, so the charts have
// something to say. The pictures are still taken on the ordinary build, so they
// show what an install looks like (every settings section, no demo band).
// Without CB_DEMO_URL it imports the small sample .xhb instead.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CB_BASE_URL ?? "http://localhost:8080";
const DEMO = process.env.CB_DEMO_URL;
const OUT = resolve(__dirname, "../docs/img");
const FIXTURE = resolve(__dirname, "fixtures/sample.xhb");
const HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const VIEWPORT = { width: 1320, height: 860 };

async function shoot(page, name) {
  await page.waitForTimeout(450); // let charts/animations settle
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log("captured", name);
}

// CB_CHROME lets a caller point at a preinstalled Chromium (e.g. a sandbox where
// `playwright install` is unavailable); otherwise Playwright's own browser is used.
const browser = await chromium.launch({
  executablePath: process.env.CB_CHROME || undefined,
});

// The demo's wallet, as a backup document: one session, one download.
async function demoBackup() {
  const ctx = await browser.newContext();
  const api = ctx.request;
  const res = await api.post(DEMO + "/api/v1/demo/session", {
    headers: HEADERS,
  });
  if (!res.ok())
    throw new Error(`demo session: ${res.status()} ${await res.text()}`);
  const wallets = await (await api.get(DEMO + "/api/v1/wallets")).json();
  const backup = await (
    await api.get(DEMO + `/api/v1/wallets/${wallets[0].id}/backup`)
  ).json();
  await ctx.close();
  return backup;
}

const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 1.5,
  colorScheme: "light",
  // The docs are in English, and CloudBank follows the browser before anyone
  // has signed in — run this on an Italian machine without saying so and the
  // whole set comes out in Italian, and every selector below misses.
  locale: "en-US",
});
const page = await ctx.newPage();

try {
  // First-run setup, and the tour offers off: each page offers its tour the
  // first time it is opened, in a corner card that would be in every capture.
  const api = page.request;
  await api.post(BASE + "/api/v1/setup", {
    headers: HEADERS,
    data: {
      username: "demo",
      email: "demo@example.com",
      password: "demodemo123",
    },
  });
  await api.patch(BASE + "/api/v1/auth/me", {
    headers: HEADERS,
    data: { preferences: { tutorialSeen: true, tourOffers: false } },
  });

  let walletId;
  if (DEMO) {
    const res = await api.post(BASE + "/api/v1/backup/restore", {
      headers: HEADERS,
      data: await demoBackup(),
    });
    if (!res.ok())
      throw new Error(`restore: ${res.status()} ${await res.text()}`);
    walletId = (await res.json()).walletId;
  } else {
    const res = await api.post(BASE + "/api/v1/import/xhb", {
      headers: {
        "Content-Type": "application/xml",
        "X-Requested-With": "XMLHttpRequest",
      },
      data: readFileSync(FIXTURE),
    });
    if (!res.ok())
      throw new Error(`import: ${res.status()} ${await res.text()}`);
    const imported = await res.json();
    walletId = imported.walletId ?? imported.wallet?.id ?? imported.id;
  }

  // Seed a look-alike pair so the Review page's duplicate finder has content.
  const accounts = await (
    await api.get(BASE + `/api/v1/wallets/${walletId}/accounts`)
  ).json();
  const today = new Date();
  const day = (back) =>
    new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
  for (const [back, memo] of [
    [9, "Gym membership"],
    [6, "GYM CLUB MONTHLY"],
  ]) {
    await api.post(BASE + `/api/v1/wallets/${walletId}/transactions`, {
      headers: HEADERS,
      data: { accountId: accounts[0].id, date: day(back), amount: -4200, memo },
    });
  }

  // The current wallet is remembered per browser: name it before the app reads it.
  await page.goto(BASE + "/");
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    walletId,
  );

  await page.goto(BASE + "/");
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  await page.waitForLoadState("networkidle");
  await shoot(page, "dashboard");

  // Dashboard customise mode (the dashboard button, not the sidebar's).
  await page.locator('[data-tour="customize"]').click();
  await shoot(page, "dashboard-customize");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // Register with a multi-selection so the bulk-action bar is visible.
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page.waitForLoadState("networkidle");
  const boxes = page.getByRole("checkbox", { name: "Select row" });
  await boxes.first().waitFor();
  for (let i = 0; i < 4; i++) await boxes.nth(i).click();
  await shoot(page, "register-bulk");

  // Bills — one row per bill (last payment + next occurrence).
  await page.goto(BASE + "/bills");
  await page.waitForLoadState("networkidle");
  await shoot(page, "bills");

  // Bank-sync review — uncategorised imports + the duplicate finder.
  await page.goto(BASE + "/review");
  await page.waitForLoadState("networkidle");
  await shoot(page, "review");

  // Reports — Cash flow, the tab with a chart and its table.
  await page.goto(BASE + "/reports?tab=cashflow");
  await page.getByRole("tab", { name: "Cash flow" }).waitFor();
  await page.locator("canvas").first().waitFor();
  await page.waitForLoadState("networkidle");
  await shoot(page, "reports");

  // Settings — appearance (theme + accent picker).
  await page.goto(BASE + "/settings/appearance");
  await page.waitForLoadState("networkidle");
  await shoot(page, "settings");

  // Settings — data: backup, .xhb export and import.
  await page.goto(BASE + "/settings/data");
  await page.waitForLoadState("networkidle");
  await shoot(page, "export");

  console.log("\nAll screenshots written to", OUT);
} finally {
  await browser.close();
}
