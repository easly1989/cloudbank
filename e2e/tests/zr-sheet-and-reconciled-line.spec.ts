import { expect, test, type Page } from "@playwright/test";

// Two things found trying the demo (#474):
//
//   - a split of several lines made the entry sheet taller than the screen, and
//     with its scrollbar hidden nothing said Save was down there;
//   - "reconciled up to here" repeated the status column when nothing was
//     filtered, and vanished under the one filter it would have helped with.
//
// Named "zr-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// Signs in and makes an account of its own; returns the wallet and account ids.
async function ready(
  page: Page,
  name: string,
): Promise<{ wid: number; acc: number }> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(
    async ({ name, h }) => {
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
          body: JSON.stringify({ title: "Sheet", baseCurrency: "EUR" }),
        });
        wallets = await (await fetch("/api/v1/wallets")).json();
      }
      const wid = wallets[0].id as number;
      // Account names are unique in a wallet, and a rerun meets its own.
      const res = await fetch(`/api/v1/wallets/${wid}/accounts`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ name: `${name} ${Date.now()}`, type: "bank" }),
      });
      if (!res.ok)
        throw new Error(`account: ${res.status} ${await res.text()}`);
      return { wid, acc: (await res.json()).id as number };
    },
    { name, h: H },
  );
}

test("Save stays in reach however long a split grows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  const { acc } = await ready(page, "Split reach");
  await page.goto(`/transactions?account=${acc}`);
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "More details" }).click();
  // The switch's own box sits over its label, so a click lands on the input.
  await sheet
    .getByRole("switch", { name: "Split across categories" })
    .evaluate((el: HTMLElement) => el.click());
  for (let i = 0; i < 4; i++) {
    await sheet.getByRole("button", { name: "Add split line" }).click();
  }

  // The sheet is now taller than the window, and Save is still on screen.
  const tall = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".txnFormContent")!;
    return el.scrollHeight > el.clientHeight;
  });
  expect(tall).toBe(true);
  const save = sheet.getByRole("button", { name: /^Save/ }).last();
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(640);
  // And the scroll is not hidden from the reader.
  const bar = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector(".txnFormContent")!)
        .scrollbarWidth,
  );
  expect(bar).not.toBe("none");
});

test("'reconciled up to here' shows only when a filter hides rows", async ({
  page,
}) => {
  const { wid, acc } = await ready(page, "Reconcile line");
  await page.evaluate(
    async ({ wid, acc, h }) => {
      for (const [date, status] of [
        ["2026-02-01", 2],
        ["2026-02-10", 0],
        ["2026-02-20", 2],
        ["2026-03-01", 0],
      ] as const) {
        await fetch(`/api/v1/wallets/${wid}/transactions`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ accountId: acc, date, amount: -1000, status }),
        });
      }
    },
    { wid, acc, h: H },
  );

  // Every status is on screen already: the line would only repeat it.
  await page.goto(`/transactions?account=${acc}`);
  await expect(page.getByText("2026-03-01").first()).toBeVisible();
  await expect(page.getByText("reconciled up to here")).toHaveCount(0);

  // Filtered to what is not reconciled: the line marks where the account was
  // reconciled to, between the newer row and the older one.
  await page.goto(`/transactions?account=${acc}&st=0`);
  const line = page.getByText("reconciled up to here");
  await expect(line).toBeVisible();
  const [newer, older, marker] = await Promise.all([
    page.getByText("2026-03-01").first().boundingBox(),
    page.getByText("2026-02-10").first().boundingBox(),
    line.boundingBox(),
  ]);
  expect(marker!.y).toBeGreaterThan(newer!.y);
  expect(marker!.y).toBeLessThan(older!.y);
});

test("under 'not reconciled' the line closes the list", async ({ page }) => {
  // The usual shape: the account was reconciled, and everything since is not.
  // Every row the filter leaves is newer, so the line sits below the last one.
  const { wid, acc } = await ready(page, "Reconciled before");
  await page.evaluate(
    async ({ wid, acc, h }) => {
      for (const [date, status] of [
        ["2026-02-01", 2],
        ["2026-02-20", 2],
        ["2026-03-01", 0],
        ["2026-03-05", 0],
      ] as const) {
        await fetch(`/api/v1/wallets/${wid}/transactions`, {
          method: "POST",
          headers: h,
          body: JSON.stringify({ accountId: acc, date, amount: -1000, status }),
        });
      }
    },
    { wid, acc, h: H },
  );

  await page.goto(`/transactions?account=${acc}&st=0`);
  const line = page.getByText("reconciled up to here");
  await expect(line).toBeVisible();
  const [last, marker] = await Promise.all([
    page.getByText("2026-03-01").first().boundingBox(),
    line.boundingBox(),
  ]);
  expect(marker!.y).toBeGreaterThan(last!.y);
  await expect(page.getByText("2026-02-20")).toBeVisible();
});
