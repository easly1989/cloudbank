import { expect, test, type Page } from "@playwright/test";

// One ordered end-to-end journey against a single fresh instance.
test.describe.configure({ mode: "serial" });

// nav clicks the sidebar link with the given (English) label.
async function nav(page: Page, label: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
}

test("full journey: setup → wallet → account → transaction → import → report → backup", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await test.step("first-run setup", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to CloudBank" })).toBeVisible();
    await page.getByLabel("Username").fill("admin");
    const pw = page.locator('input[type="password"]');
    await pw.first().fill("supersecret1");
    await pw.nth(1).fill("supersecret1");
    await page.getByRole("button", { name: "Create admin account" }).click();
  });

  await test.step("create the first wallet", async () => {
    await expect(page.getByRole("heading", { name: "Create your first wallet" })).toBeVisible();
    await page.getByLabel("Wallet name").fill("Test Wallet");
    await page.getByRole("button", { name: "Create wallet" }).click();
    await expect(page.getByRole("button", { name: "Test Wallet" })).toBeVisible();
  });

  await test.step("dismiss the first-login tour", async () => {
    // Entering the app for the first time auto-runs the onboarding tour; its
    // backdrop blocks the page, so skip it before driving the rest of the journey.
    await page.getByRole("button", { name: "Skip" }).click();
  });

  await test.step("create an account", async () => {
    await nav(page, "Accounts");
    await page.getByRole("button", { name: "Add account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Account name").fill("Checking");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Checking" })).toBeVisible();
  });

  await test.step("quick-add a transaction", async () => {
    await nav(page, "Transactions");
    // The single account is auto-selected; fill the quick-add row.
    await page.getByLabel("Date", { exact: true }).fill("2026-02-01");
    await page.getByLabel("Amount", { exact: true }).fill("12.50");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    // The new row shows in the register.
    await expect(page.getByText("2026-02-01")).toBeVisible();
  });

  await test.step("enter and cancel the reconcile workflow", async () => {
    await page.getByRole("button", { name: "Reconcile" }).click();
    await expect(page.getByLabel("Statement balance")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("import a HomeBank .xhb file", async () => {
    // Import lives under Settings → the wallet tab → "Import & export" section
    // (it's wallet-scoped, so it's out of the main nav); deep-link straight to it.
    await page.goto("/settings?tab=wallet&section=import");
    await page.setInputFiles('input[type="file"]', "fixtures/sample.xhb");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Import complete")).toBeVisible();
  });

  await test.step("the import switched to the new wallet", async () => {
    // ImportPage selects the freshly created wallet automatically.
    await expect(page.getByRole("button", { name: "My Money" })).toBeVisible();
  });

  await test.step("a report renders", async () => {
    await nav(page, "Reports");
    await expect(page.getByRole("tab", { name: "Statistics" })).toBeVisible();
    // The statistics report draws an ECharts canvas.
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  await test.step("the imported schedule can be posted", async () => {
    await nav(page, "Schedules");
    const postNow = page.getByRole("button", { name: "Post now" }).first();
    await expect(postNow).toBeVisible();
    await postNow.click();
  });

  await test.step("download a wallet backup", async () => {
    // Wallet settings live under Settings → Wallet tab.
    await nav(page, "Settings");
    await page.getByRole("tab", { name: "Wallet" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("backup");
  });
});
