import { expect, test, type Page } from "@playwright/test";

// A transaction added behind the page's back — another device, a bank sync, a
// bank mail, an auto-posted schedule — shows up in the open register without a
// reload. It used to wait for the reader to leave the page and come back.
// Named "zrf-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};
const CREDENTIALS = { username: "admin", password: "supersecret1" };

test.use({ viewport: { width: 1440, height: 1000 } });

async function openRegister(
  page: Page,
): Promise<{ wallet: number; account: number }> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ([h, creds]) => {
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
        needsSetup ? { ...creds, email: "a@b.com" } : creds,
      );
      const me = await call("GET", "/api/v1/auth/me");
      await call("PATCH", "/api/v1/auth/me", {
        preferences: {
          ...me.preferences,
          tutorialSeen: true,
          tourOffers: false,
        },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Live ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const a = await call("POST", `/api/v1/wallets/${w.id}/accounts`, {
        name: "Current",
        type: "bank",
      });
      await call("POST", `/api/v1/wallets/${w.id}/transactions`, {
        accountId: a.id,
        date: "2026-03-01",
        amount: -1000,
        memo: "Already there",
      });
      return { wallet: w.id as number, account: a.id as number };
    },
    [H, CREDENTIALS] as const,
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  await page.goto(`/transactions?account=${ids.account}`);
  await expect(
    page.getByRole("region", { name: "Account ledger" }),
  ).toContainText("Already there");
  return ids;
}

// A second browser session with its own cookies: another device, as far as
// the server can tell.
async function addFromAnotherDevice(
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
  baseURL: string,
  ids: { wallet: number; account: number },
  memo: string,
) {
  const other = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: H,
  });
  try {
    const login = await other.post("/api/v1/auth/login", { data: CREDENTIALS });
    expect(login.ok()).toBe(true);
    const made = await other.post(
      `/api/v1/wallets/${ids.wallet}/transactions`,
      {
        data: {
          accountId: ids.account,
          date: "2026-03-02",
          amount: -2500,
          memo,
        },
      },
    );
    expect(made.ok()).toBe(true);
  } finally {
    await other.dispose();
  }
}

test("a transaction added elsewhere shows up when the tab regains focus", async ({
  page,
  playwright,
  baseURL,
}) => {
  const ids = await openRegister(page);
  const ledger = page.getByRole("region", { name: "Account ledger" });

  await addFromAnotherDevice(playwright, baseURL!, ids, "From another device");
  await expect(ledger).not.toContainText("From another device");

  // What the browser fires when the reader comes back to the tab.
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
  );
  await expect(ledger).toContainText("From another device");
  await expect(ledger).toContainText("Already there");
});

test("a transaction added elsewhere shows up on its own while the page stays open", async ({
  page,
  playwright,
  baseURL,
}) => {
  // The page polls on a timer; the fake clock skips the wait.
  await page.clock.install();
  const ids = await openRegister(page);
  const ledger = page.getByRole("region", { name: "Account ledger" });

  await addFromAnotherDevice(
    playwright,
    baseURL!,
    ids,
    "Posted in the background",
  );
  await expect(ledger).not.toContainText("Posted in the background");

  await page.clock.runFor(61_000);
  await expect(ledger).toContainText("Posted in the background");
});
