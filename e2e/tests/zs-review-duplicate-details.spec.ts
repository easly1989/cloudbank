import { expect, test } from "@playwright/test";

// A suspected duplicate pair is compared field by field, with the bank's long
// description in full: cut short, the two could not be told apart (#484).
//
// Named "zs-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const MEMO =
  "CARD PAYMENT 4000 XXXX XXXX XX02 MADE ON 2026-03-02 AT 18:42 CITY GYM MEMBERSHIP MARCH TERMINAL 0042 MILANO REF 000123456789 EXCHANGE RATE 1,0000 NO FEE";

test("a duplicate pair shows every field, and the whole memo", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(
    async ({ h, memo }) => {
      const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
        .needsSetup as boolean;
      await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
        method: "POST",
        headers: h,
        body: JSON.stringify(
          needsSetup
            ? { username: "admin", email: "a@b.com", password: "supersecret1" }
            : { username: "admin", password: "supersecret1" },
        ),
      });
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({
          preferences: { tutorialSeen: true, tourOffers: false },
        }),
      });
      let wallets = await (await fetch("/api/v1/wallets")).json();
      if (!Array.isArray(wallets) || wallets.length === 0) {
        await fetch("/api/v1/wallets", {
          method: "POST",
          headers: h,
          body: JSON.stringify({ title: "Review", baseCurrency: "EUR" }),
        });
        wallets = await (await fetch("/api/v1/wallets")).json();
      }
      const wid = wallets[0].id as number;
      localStorage.setItem("cb.currentWalletId", String(wid));
      const acc = (await (
        await fetch(`/api/v1/wallets/${wid}/accounts`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ name: `Gym ${Date.now()}`, type: "bank" }),
        })
      ).json()) as { id: number };
      // By hand, then the bank's row for the same movement, a few days off.
      await fetch(`/api/v1/wallets/${wid}/transactions`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          accountId: acc.id,
          date: "2026-03-02",
          amount: -3917,
          memo: "gym",
          info: "hand",
          tags: ["sport"],
        }),
      });
      await fetch(`/api/v1/wallets/${wid}/import/commit`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          accountId: acc.id,
          rows: [
            {
              date: "2026-03-10",
              amount: -3917,
              memo,
              paymentMode: 6,
              importRef: `e2e-review:${Date.now()}`,
            },
          ],
        }),
      });
    },
    { h: H, memo: MEMO },
  );

  await page.goto("/review");
  const dups = page.locator('[data-tour="review-duplicates"]');
  const memo = dups.getByText(MEMO, { exact: true });
  await expect(memo).toBeVisible();
  // Whole, not cut short with an ellipsis.
  const cut = await memo.evaluate(
    (el) =>
      el.scrollWidth > el.clientWidth ||
      getComputedStyle(el).textOverflow === "ellipsis",
  );
  expect(cut).toBe(false);
  // The rest of the pair is there to compare, field by field.
  for (const label of ["Info / check no.", "Payment", "Tags", "Status"]) {
    await expect(dups.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(dups.getByText("Debit card").first()).toBeVisible();
  await expect(dups.getByText("sport", { exact: true }).first()).toBeVisible();
});
