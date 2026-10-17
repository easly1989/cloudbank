import { expect, test, type Page } from "@playwright/test";

// Rows read from bank mails that the bank has not booked (#660): marked in the
// register until the bank confirms them, and after 5 days asked about in the
// review, to merge into the bank's row or delete; a refused card's payment and
// reversal are deleted together.
//
// Named "zt-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone. It leaves nothing to review behind.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

// Signs in, makes an account of its own and imports into it, through the same
// commit the bank sync and the mail reader use, rows as a mail and the bank
// would have written them.
async function seed(page: Page): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const stamp = Date.now();
  return page.evaluate(
    async ({ h, rows }) => {
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
          body: JSON.stringify({
            name: `Mail rows ${Date.now()}`,
            type: "bank",
          }),
        })
      ).json()) as { id: number };
      await fetch(`/api/v1/wallets/${wid}/import/commit`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ accountId: acc.id, rows }),
      });
      return acc.id;
    },
    {
      h: H,
      // Every row has a category, so only what #660 adds is left to review.
      rows: [
        // The pump held 100 and the bank charged 40.
        {
          date: daysAgo(7),
          amount: -10000,
          memo: "Distributore Demo",
          category: "Auto",
          importRef: `mail:e2e-${stamp}-a`,
        },
        {
          date: daysAgo(6),
          amount: -4000,
          memo: "POS DISTRIBUTORE DEMO",
          category: "Other",
          importRef: `e2e-bank:${stamp}`,
        },
        // A refused card: the payment and its reversal.
        {
          date: daysAgo(8),
          amount: -750,
          memo: "Bar Demo",
          category: "Auto",
          importRef: `mail:e2e-${stamp}-b`,
        },
        {
          date: daysAgo(8),
          amount: 750,
          memo: "Storno Bar Demo",
          category: "Auto",
          importRef: `mail:e2e-${stamp}-c`,
        },
        // Too recent to ask about: the bank still has time.
        {
          date: daysAgo(2),
          amount: -1200,
          memo: "Edicola Demo",
          category: "Auto",
          importRef: `mail:e2e-${stamp}-d`,
        },
      ],
    },
  );
}

test("rows from mails are marked, then merged or deleted in the review", async ({
  page,
}) => {
  const account = await seed(page);

  // The register marks the four rows from mails, not the bank's.
  await page.goto(`/transactions?account=${account}`);
  await expect(page.getByTestId("from-mail")).toHaveCount(4);
  await page.getByRole("link", { name: "2 to review" }).click();

  const section = page.getByTestId("review-unconfirmed");
  await expect(section).toContainText("Not confirmed by the bank (2)");
  await expect(section.getByText("Edicola Demo")).toHaveCount(0);

  // The pump's row merges into the bank's.
  const row = section
    .getByTestId("review-unconfirmed-row")
    .filter({ hasText: "Distributore Demo" });
  await expect(row).toContainText("POS DISTRIBUTORE DEMO");
  await row.getByRole("button", { name: "Merge" }).click();
  await expect(page.getByText("Merged", { exact: true })).toBeVisible();

  // The refused payment and its reversal go together.
  const pair = section.getByTestId("review-reversal");
  await expect(pair).toContainText("Payment reversed");
  await expect(pair).toContainText("Storno Bar Demo");
  await pair.getByRole("button", { name: "Delete both" }).click();
  await page
    .getByRole("dialog", { name: "Delete both rows?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(page.getByTestId("review-done")).toBeVisible();

  // One row is left from the bank, with the mail's words; one from a mail.
  await page.goto(`/transactions?account=${account}`);
  await expect(page.getByTestId("from-mail")).toHaveCount(1);
  await expect(page.getByText("Distributore Demo")).toBeVisible();
  await expect(page.getByText("POS DISTRIBUTORE DEMO")).toHaveCount(0);
  await expect(page.getByText("Bar Demo", { exact: true })).toHaveCount(0);
});
