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
    await expect(
      page.getByRole("heading", { name: "Welcome to CloudBank" }),
    ).toBeVisible();
    await page.getByLabel("Username").fill("admin");
    const pw = page.locator('input[type="password"]');
    await pw.first().fill("supersecret1");
    await pw.nth(1).fill("supersecret1");
    await page.getByRole("button", { name: "Create admin account" }).click();
  });

  await test.step("create the first wallet", async () => {
    await expect(
      page.getByRole("heading", { name: "Create your first wallet" }),
    ).toBeVisible();
    await page.getByLabel("Wallet name").fill("Test Wallet");
    await page.getByRole("button", { name: "Create wallet" }).click();
    await expect(
      page.getByRole("button", { name: "Switch wallet" }),
    ).toContainText("Test Wallet");
  });

  await test.step("the overview offers its tour, and it can be declined", async () => {
    // The first page anyone sees offers its tour in a corner card (#421). The
    // journey declines, then turns the offers off: every page after this one
    // would make the same offer, and the journey is about something else.
    const offer = page.locator("[data-tour-offer]");
    await expect(offer).toContainText("New here? Take a quick tour");
    await offer.getByRole("button", { name: "No thanks" }).click();
    await expect(offer).toHaveCount(0);
    await page.evaluate(async () => {
      const me = await (
        await fetch("/api/v1/auth/me", { credentials: "same-origin" })
      ).json();
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify({
          preferences: { ...me.preferences, tourOffers: false },
        }),
      });
    });
    await page.reload();
  });

  await test.step("create an account", async () => {
    await nav(page, "Accounts");
    await page.getByRole("button", { name: "Add account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Account name").fill("Checking");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("cell", { name: "Checking" })).toBeVisible();
  });

  await test.step("add a transaction from the first row of the ledger", async () => {
    await nav(page, "Transactions");
    // The way in is the first line of the register, where the transaction will
    // land; it opens the entry sheet beside the rows.
    await page.getByRole("button", { name: /New entry/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Date", { exact: true }).fill("2026-02-01");
    await sheet.getByLabel("Amount", { exact: true }).fill("12.50");
    // "Save and add another" keeps the sheet open for the next entry, which
    // is the point of a side panel; "Save" is the one that puts it away.
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    // The new row shows in the register.
    await expect(page.getByText("2026-02-01")).toBeVisible();
  });

  await test.step("attach a file to the transaction", async () => {
    // Double-click the register row to open its edit form (which hosts the
    // attachments field), upload a file, and confirm it is listed. The upload
    // persists immediately, independently of the form's Save.
    await page.getByText("2026-02-01").first().dblclick();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Attachments are among the fields the board does not draw, so they sit
    // under "More details", closed on a row that has none yet.
    await dialog.getByRole("button", { name: "More details" }).click();
    await dialog
      .locator('input[type="file"]')
      .setInputFiles("fixtures/receipt.txt");
    await expect(dialog.getByText("receipt.txt")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("enter and cancel the reconcile workflow", async () => {
    // Reconciling is a workflow, not one of the register's two headline
    // actions, so it lives in the header's overflow menu.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Reconcile" }).click();
    await expect(page.getByLabel("Statement balance")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("import a HomeBank .xhb file", async () => {
    // Import lives under Settings → "Import & export"
    // (it's wallet-scoped, so it's out of the main nav); deep-link straight to it.
    await page.goto("/settings/data");
    await page.setInputFiles('input[type="file"]', "fixtures/sample.xhb");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByText("Import complete")).toBeVisible();
  });

  await test.step("the import switched to the new wallet", async () => {
    // ImportPage selects the freshly created wallet automatically. The wallet
    // card is in the app's sidebar, and settings is its own screen without one,
    // so leave settings before looking for it.
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Switch wallet" }),
    ).toContainText("My Money");
  });

  await test.step("a report renders", async () => {
    await nav(page, "Reports");
    await expect(page.getByRole("tab", { name: "Spending" })).toBeVisible();
    // The answer comes first: the month's spending, before any control.
    await expect(page.getByTestId("spending-total")).toBeVisible();
    // The cash flow draws an ECharts canvas.
    await page.goto("/reports?tab=cashflow&p=all");
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  await test.step("the imported schedule can be posted", async () => {
    await nav(page, "Schedules");
    const postNow = page.getByRole("button", { name: "Post now" }).first();
    await expect(postNow).toBeVisible();
    await postNow.click();
  });

  await test.step("download a wallet backup", async () => {
    // Backup lives under Settings → "Import & export", below the import tools
    // section; deep-link straight to it.
    await page.goto("/settings/data");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download backup" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("backup");
  });
});
