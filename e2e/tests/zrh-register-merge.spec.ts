import { expect, test, type Page } from "@playwright/test";

// Two register rows for the same spending merge into one, field by field, and
// the merge is undone (#786): the bank's row stays with the words typed by hand,
// keeps its import ref so the bank's row is not imported again, and Undo brings
// both rows back.
//
// Named "zr-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

interface Seeded {
  wid: number;
  account: number;
  ref: string;
}

async function seed(page: Page): Promise<Seeded> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(async (h) => {
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
        body: JSON.stringify({ title: "Merge", baseCurrency: "EUR" }),
      });
      wallets = await (await fetch("/api/v1/wallets")).json();
    }
    const wid = wallets[0].id as number;
    localStorage.setItem("cb.currentWalletId", String(wid));
    const acc = (await (
      await fetch(`/api/v1/wallets/${wid}/accounts`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: `Merge ${Date.now()}`, type: "bank" }),
      })
    ).json()) as { id: number };
    // By hand first, then the bank's row for the same spending.
    await fetch(`/api/v1/wallets/${wid}/transactions`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        accountId: acc.id,
        date: "2026-11-29",
        amount: -1299,
        memo: "Humble Choice",
        tags: ["subscriptions"],
      }),
    });
    const ref = `e2e-merge:${Date.now()}`;
    await fetch(`/api/v1/wallets/${wid}/import/commit`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        accountId: acc.id,
        rows: [
          {
            date: "2026-11-26",
            amount: -1299,
            memo: "PP*HUMBLEBUNDL",
            importRef: ref,
          },
        ],
      }),
    });
    return { wid, account: acc.id, ref };
  }, H);
}

// The account's register rows, as the server has them.
const rows = (page: Page, s: Seeded) =>
  page.evaluate(
    async ({ wid, account }) =>
      (
        await (
          await fetch(
            `/api/v1/wallets/${wid}/transactions/register?accountId=${account}`,
          )
        ).json()
      ).rows as { id: number; date: string; memo: string; tags: string[] }[],
    s,
  );

test("two rows merge into one, field by field, and Undo brings both back", async ({
  page,
}) => {
  const s = await seed(page);
  const before = await rows(page, s);
  expect(before).toHaveLength(2);

  await page.goto(`/transactions?account=${s.account}`);
  const ledger = page.getByLabel("Account ledger");
  for (const memo of ["Humble Choice", "PP*HUMBLEBUNDL"]) {
    await ledger
      .locator("div")
      .filter({ has: page.getByRole("checkbox", { name: "Select row" }) })
      .filter({ hasText: memo })
      .last()
      .locator(".cb-row-select")
      .click();
  }
  await page.getByRole("button", { name: "Merge", exact: true }).click();

  // The bank's row is column 1; its date stays, the hand row's words come in.
  const dialog = page.getByRole("dialog", { name: "Merge 2 rows" });
  await expect(
    dialog.getByRole("radio", { name: "2 · Memo: Humble Choice" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("radio", { name: "1 · Date: 2026-11-26" }),
  ).toBeChecked();
  await expect(dialog.getByTestId("merge-result")).toContainText(
    "Humble Choice",
  );
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Merged into one row")).toBeVisible();

  const merged = await rows(page, s);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    date: "2026-11-26",
    memo: "Humble Choice",
    tags: ["subscriptions"],
  });

  // It is the bank's row, with the bank's ref: sync knows it and adds nothing.
  const kept = await page.evaluate(
    async ({ wid, id }) =>
      (await (
        await fetch(`/api/v1/wallets/${wid}/transactions/${id}`)
      ).json()) as {
        importRef?: string;
      },
    { wid: s.wid, id: merged[0].id },
  );
  expect(kept.importRef).toBe(s.ref);

  await page.getByRole("button", { name: "Undo merge" }).click();
  await expect(page.getByText("Both rows are back")).toBeVisible();
  const back = await rows(page, s);
  expect(back.map(({ id, date, memo }) => ({ id, date, memo }))).toEqual(
    before.map(({ id, date, memo }) => ({ id, date, memo })),
  );
  await expect(ledger.getByText("PP*HUMBLEBUNDL")).toBeVisible();
});
