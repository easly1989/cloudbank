import { expect, test, type Page } from "@playwright/test";

// The file import wizard, driven the way a person drives it: pick the format,
// the account and the file, map the columns, preview, import. Rows without
// tags once reached the review as `tags: null`, and the tag field's crash
// blanked the whole page at the preview, for every format — for two months,
// because nothing walked through the wizard. Named "zy-" so it runs after the
// main journey, whose admin it reuses; its account is deleted afterwards.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

let accountUrl = "";

test.afterEach(async ({ page }) => {
  if (!accountUrl) return;
  await page.evaluate(
    async ({ H, url }) => {
      await fetch(url, { method: "DELETE", headers: H });
    },
    { H, url: accountUrl },
  );
  accountUrl = "";
});

/** Signs in and makes an empty account to import into; returns its name. */
async function setUp(page: Page): Promise<string> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const [url, name] = await page.evaluate(async (H) => {
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
      .needsSetup as boolean;
    await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
      method: "POST",
      headers: H,
      body: JSON.stringify(
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      ),
    });
    const me = await (await fetch("/api/v1/auth/me")).json();
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      headers: H,
      body: JSON.stringify({
        preferences: {
          ...me.preferences,
          tutorialSeen: true,
          tourOffers: false,
        },
      }),
    });
    let wallets = await (await fetch("/api/v1/wallets")).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ title: "Import", baseCurrency: "EUR" }),
      });
      wallets = await (await fetch("/api/v1/wallets")).json();
    }
    const w = wallets[0].id;
    const name = `Import ${Date.now()}`;
    const acc = await (
      await fetch(`/api/v1/wallets/${w}/accounts`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ name, type: "bank" }),
      })
    ).json();
    return [`/api/v1/wallets/${w}/accounts/${acc.id}`, name] as const;
  }, H);
  accountUrl = url;
  return name;
}

/** Opens the wizard with a format, the account and a file picked. */
async function start(
  page: Page,
  format: string,
  account: string,
  file: string,
  body: string,
) {
  await page.goto("/settings/data");
  await page.getByRole("tab", { name: "Bank / CSV / QIF / OFX" }).click();
  const panel = page.getByRole("tabpanel", { name: "Bank / CSV / QIF / OFX" });
  await panel.getByText(format, { exact: true }).click();
  await panel.getByRole("combobox", { name: "Target account" }).click();
  await page.getByRole("option", { name: account }).click();
  await panel.locator('input[type="file"]').setInputFiles({
    name: file,
    mimeType: "text/plain",
    buffer: Buffer.from(body),
  });
  await panel.getByRole("button", { name: "Next" }).click();
  return panel;
}

test("a generic CSV maps, previews and imports", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const account = await setUp(page);

  const panel = await start(
    page,
    "Generic CSV",
    account,
    "bank.csv",
    "Date,Description,Amount\n2026-09-01,Coffee shop,-3.50\n2026-09-02,Salary,2450.00\n",
  );

  // Map by position: date, amount, debit, credit, payee, memo, …
  const fields = panel.locator("input.mantine-Select-input");
  for (const [i, column] of [
    [0, "Date"],
    [1, "Amount"],
    [5, "Description"],
  ] as const) {
    await fields.nth(i).click();
    await page.getByRole("option", { name: column, exact: true }).click();
  }
  await panel.getByRole("button", { name: "Preview" }).click();

  await expect(panel.getByRole("cell", { name: "2026-09-02" })).toBeVisible();
  await panel.getByRole("button", { name: /^Import 2/ }).click();
  await expect(page.getByText("Created 2 transactions.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a QIF file previews and imports", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const account = await setUp(page);

  const panel = await start(
    page,
    "QIF",
    account,
    "bank.qif",
    "!Type:Bank\nD2026-09-01\nT-3.50\nPCoffee shop\n^\nD2026-09-02\nT2450.00\nPEmployer\n^\n",
  );

  await expect(panel.getByRole("cell", { name: "Employer" })).toBeVisible();
  await panel.getByRole("button", { name: /^Import 2/ }).click();
  await expect(page.getByText("Created 2 transactions.")).toBeVisible();
  expect(errors).toEqual([]);
});
