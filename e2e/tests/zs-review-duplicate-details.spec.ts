import { expect, test, type Page } from "@playwright/test";

// The Review page shows a bank's long descriptions in full:
//
//   - a suspected duplicate pair is compared field by field (#484);
//   - a row that needs a category keeps its whole memo, and on a phone its
//     category picker goes underneath instead of being squeezed (#486);
//   - opened from a register, it leads back there, and says when nothing is
//     left (#570).
//
// Named "zs-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const MEMO =
  "CARD PAYMENT 4000 XXXX XXXX XX02 MADE ON 2026-03-02 AT 18:42 CITY GYM MEMBERSHIP MARCH TERMINAL 0042 MILANO REF 000123456789 EXCHANGE RATE 1,0000 NO FEE";

// Signs in, makes an account of its own, and imports one bank row with `memo`
// and no category; with `manual`, the same movement entered by hand first.
async function seed(
  page: Page,
  memo: string,
  manual: boolean,
): Promise<{ account: number; name: string }> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(
    async ({ h, memo, manual }) => {
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
          body: JSON.stringify({ name: `Review ${Date.now()}`, type: "bank" }),
        })
      ).json()) as { id: number; name: string };
      if (manual) {
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
      }
      await fetch(`/api/v1/wallets/${wid}/import/commit`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          accountId: acc.id,
          rows: [
            {
              date: "2026-03-10",
              amount: manual ? -3917 : -1890,
              memo,
              paymentMode: 6,
              importRef: `e2e-review:${Date.now()}`,
            },
          ],
        }),
      });
      return { account: acc.id, name: acc.name };
    },
    { h: H, memo, manual },
  );
}

// Whether an element's text is cut short, by overflow or an ellipsis.
const cutShort = (el: HTMLElement | SVGElement) =>
  el.scrollWidth > el.clientWidth ||
  getComputedStyle(el).textOverflow === "ellipsis";

test("a duplicate pair shows every field, and the whole memo", async ({
  page,
}) => {
  await seed(page, MEMO, true);
  await page.goto("/review");
  const dups = page.locator('[data-tour="review-duplicates"]');
  const memo = dups.getByText(MEMO, { exact: true });
  await expect(memo).toBeVisible();
  expect(await memo.evaluate(cutShort)).toBe(false);
  // The rest of the pair is there to compare, field by field.
  for (const label of ["Info / check no.", "Payment", "Tags", "Status"]) {
    await expect(dups.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(dups.getByText("Debit card").first()).toBeVisible();
  await expect(dups.getByText("sport", { exact: true }).first()).toBeVisible();
});

test("a row that needs a category keeps its whole memo, on a phone too", async ({
  page,
}) => {
  const memo = `DIRECT DEBIT SEPA CORE MANDATE IT00ZZZ0000000000000 CREDITOR ACME INSURANCE SPA INVOICE ${Date.now()} PERIOD MARCH`;
  await seed(page, memo, false);

  await page.goto("/review");
  const needs = page.locator('[data-tour="review-categories"]');
  const text = needs.getByText(memo, { exact: true });
  await expect(text).toBeVisible();
  expect(await text.evaluate(cutShort)).toBe(false);

  // On a phone the picker sits under the description, as wide as it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const row = needs.getByTestId("needs-category-row").filter({ hasText: memo });
  await expect(text).toBeVisible();
  expect(await text.evaluate(cutShort)).toBe(false);
  const [desc, picker] = await Promise.all([
    text.boundingBox(),
    row.getByRole("combobox", { name: "Category" }).boundingBox(),
  ]);
  expect(picker!.y).toBeGreaterThan(desc!.y + desc!.height - 1);
  expect(picker!.width).toBeGreaterThan(300);
});

test("opened from a register, the review leads back to it", async ({
  page,
}) => {
  const memo = `CARD PAYMENT BAKERY ${Date.now()}`;
  const { account, name } = await seed(page, memo, false);
  const category = `Bakery ${Date.now()}`;
  await page.evaluate(
    async ({ h, category }) => {
      const wid = localStorage.getItem("cb.currentWalletId");
      await fetch(`/api/v1/wallets/${wid}/categories`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: category }),
      });
    },
    { h: H, category },
  );

  await page.goto(`/transactions?account=${account}`);
  await page.getByRole("link", { name: "1 to review" }).click();
  const back = page.getByTestId("review-back");
  await expect(back).toHaveText(name);

  // Showing every account keeps the way back.
  await page.getByRole("button", { name: "Show all accounts" }).click();
  await expect(back).toHaveText(name);
  // It replaced the page in the history, so back is the register.
  await page.goBack();
  await page.getByRole("link", { name: "1 to review" }).click();

  // The last row given a category: the end, and the button back.
  const row = page.getByTestId("needs-category-row").filter({ hasText: memo });
  await row.getByRole("combobox", { name: "Category" }).fill(category);
  await page.getByRole("option", { name: category }).click();
  const done = page.getByTestId("review-done");
  await expect(done).toContainText("Nothing left to review");
  await expect(done).toContainText(`Every transaction in ${name}`);
  await done.getByRole("link", { name: `Back to ${name}` }).click();
  await expect(page).toHaveURL(
    new RegExp(`/transactions\\?account=${account}$`),
  );
});

test("opened from the menu, the review offers no way back", async ({
  page,
}) => {
  await seed(page, `MENU ${Date.now()}`, false);
  await page.goto("/review");
  await expect(page.getByTestId("needs-category-row").first()).toBeVisible();
  await expect(page.getByTestId("review-back")).toHaveCount(0);
});
