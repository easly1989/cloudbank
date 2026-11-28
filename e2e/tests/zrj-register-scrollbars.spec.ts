import { expect, test, type Page } from "@playwright/test";

// The ledger's vertical scrollbar takes width from its rows on systems where
// scrollbars take room (Windows). The rows once overflowed the ledger by that
// width, and the register showed two sideways scrollbars, one above the other.
// Headless Chromium hides scrollbars by default, which is how this slipped
// past the suite: this file turns them back on.
// On a wallet of its own; named "zrj-" so it runs after the main journey,
// whose admin it reuses, and it also sets itself up when run alone.

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// A wallet of its own with enough rows for the ledger to scroll, opened on
// the register with the admin's column preferences back to their defaults.
async function openRegister(page: Page) {
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
    delete prefs.registerGrowColumn;
    await call("PATCH", "/api/v1/auth/me", {
      preferences: { ...prefs, tutorialSeen: true, tourOffers: false },
    });
    const w = await call("POST", "/api/v1/wallets", {
      title: `Bars ${Date.now()}`,
      baseCurrency: "EUR",
    });
    const base = `/api/v1/wallets/${w.id}`;
    const acc = await call("POST", `${base}/accounts`, {
      name: "Checking",
      type: "bank",
      initialBalance: 100000,
    });
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < 30; i++) {
      await call("POST", `${base}/transactions`, {
        accountId: acc.id,
        date: today,
        amount: -100 - i,
        memo: `Groceries ${i}`,
      });
    }
    return { wallet: w.id as number, account: acc.id as number };
  }, H);
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  await page.goto(`/transactions?account=${ids.account}`);
  await expect(page.getByText("Groceries 29")).toBeVisible();
}

// How the ledger and its bands measure: the ledger's own sideways overflow,
// its scrollbar's width, and where the header and the first row end their
// last column (the row actions), which must line up.
const measure = (page: Page) =>
  page.evaluate(() => {
    const ledger = document.querySelector<HTMLElement>(".cb-ledger")!;
    const header = [...ledger.parentElement!.children].find(
      (c) => c !== ledger && getComputedStyle(c).display === "grid",
    )!;
    const row = [...ledger.firstElementChild!.children].find(
      (c) => getComputedStyle(c).display === "grid",
    )!;
    const end = (el: Element) =>
      el.lastElementChild!.getBoundingClientRect().right;
    const start = (el: Element) =>
      el.firstElementChild!.getBoundingClientRect().left;
    const card = ledger.parentElement!.parentElement!;
    return {
      cardScrolls: card.scrollWidth > card.clientWidth,
      gutter: ledger.offsetWidth - ledger.clientWidth,
      overflow: ledger.scrollWidth - ledger.clientWidth,
      headerStart: start(header),
      rowStart: start(row),
      headerEnd: end(header),
      rowEnd: end(row),
    };
  });

// 1100: the card is narrower than a row and scrolls sideways itself. 1440 and
// 2200: the row fits and its widest column takes the room left.
for (const width of [1100, 1440, 2200]) {
  test(`the register has one sideways scrollbar and aligned columns at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openRegister(page);
    const m = await measure(page);
    // Scrollbars take room here, or the test proves nothing.
    expect(m.gutter).toBeGreaterThan(0);
    expect(m.cardScrolls).toBe(width === 1100);
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(Math.abs(m.headerStart - m.rowStart)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.headerEnd - m.rowEnd)).toBeLessThanOrEqual(1);
  });
}

// At 125% scaling the scrollbar is a fraction of a pixel wide in CSS pixels,
// and a width rounded down left the row that fraction short.
test("the register has one sideways scrollbar at 125% scaling", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1100, height: 900 },
    deviceScaleFactor: 1.25,
  });
  const page = await context.newPage();
  await openRegister(page);
  const m = await measure(page);
  expect(m.gutter).toBeGreaterThan(0);
  expect(m.overflow).toBeLessThanOrEqual(0);
  await context.close();
});
