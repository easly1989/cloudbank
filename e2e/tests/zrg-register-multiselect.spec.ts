import { expect, test } from "@playwright/test";

// Ctrl+click toggles a register row and Shift+click adds the rows from the
// anchor to the one clicked, as in a file manager. Named "zrg-" so it runs
// after the main journey, whose admin it reuses; it also sets itself up alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};
const CREDENTIALS = { username: "admin", password: "supersecret1" };

test.use({ viewport: { width: 1440, height: 1000 } });

test("ctrl+click and shift+click select several rows", async ({ page }) => {
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
        title: `Multi ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const a = await call("POST", `/api/v1/wallets/${w.id}/accounts`, {
        name: "Current",
        type: "bank",
      });
      for (let n = 1; n <= 5; n++) {
        await call("POST", `/api/v1/wallets/${w.id}/transactions`, {
          accountId: a.id,
          date: `2026-03-0${n}`,
          amount: -1000 * n,
          memo: `Pick row ${n}`,
        });
      }
      return { wallet: w.id as number, account: a.id as number };
    },
    [H, CREDENTIALS] as const,
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  await page.goto(`/transactions?account=${ids.account}`);
  const ledger = page.getByRole("region", { name: "Account ledger" });
  await expect(ledger).toContainText("Pick row 5");

  // Newest first: 5, 4, 3, 2, 1. Ctrl on 5 and 3 picks those two; Shift on 1
  // then adds everything from the anchor (3) down to 1.
  await ledger.getByText("Pick row 5").click({ modifiers: ["Control"] });
  await ledger.getByText("Pick row 3").click({ modifiers: ["Control"] });
  await expect(page.getByText("2 selected")).toBeVisible();
  await ledger.getByText("Pick row 1").click({ modifiers: ["Shift"] });
  await expect(page.getByText("4 selected")).toBeVisible();

  // Ctrl again takes one off.
  await ledger.getByText("Pick row 5").click({ modifiers: ["Control"] });
  await expect(page.getByText("3 selected")).toBeVisible();
});
