import { expect, test } from "@playwright/test";

// A transfer row's menu offers Duplicate (#790): it opens the transfer form as
// a new transfer, filled from the original, and saving adds a second transfer
// while the original stays as it was.
//
// Named "zr-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test("a transfer duplicates into a new transfer", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h }) => {
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
        title: `Transfer duplicate ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const checking = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
      });
      const savings = await call("POST", `${base}/accounts`, {
        name: "Savings",
        type: "savings",
      });
      await call("POST", `${base}/transfers`, {
        fromAccountId: checking.id,
        toAccountId: savings.id,
        date: "2026-03-01",
        fromAmount: 10000,
        memo: "Monthly saving",
        status: 1,
      });
      return { wallet: w.id as number, base, account: checking.id as number };
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  await page.goto(`/transactions?account=${ids.account}`);

  await page
    .getByText("Monthly saving", { exact: true })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  const dialog = page.getByRole("dialog", { name: "New transfer" });
  await expect(dialog.getByLabel("Memo", { exact: true })).toHaveValue(
    "Monthly saving",
  );
  await expect(dialog.getByLabel("Amount", { exact: true })).toHaveValue(
    "100.00",
  );
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(
    "2026-03-01",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Two transfers now, the copy unreconciled; the original keeps its status.
  const rows = await page.evaluate(
    async ({ base, account }) =>
      (
        await (
          await fetch(`${base}/transactions/register?accountId=${account}`)
        ).json()
      ).rows as {
        date: string;
        memo: string;
        status: number;
        transferId: number | null;
      }[],
    ids,
  );
  expect(rows).toHaveLength(2);
  expect(
    rows.every((r) => r.memo === "Monthly saving" && r.date === "2026-03-01"),
  ).toBe(true);
  expect(new Set(rows.map((r) => r.transferId)).size).toBe(2);
  expect(rows.map((r) => r.status).sort()).toEqual([0, 1]);
});
