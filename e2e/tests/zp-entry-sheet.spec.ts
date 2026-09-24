import { expect, test, type Page } from "@playwright/test";

// The entry sheet, rebuilt to its board (#469), does four things the old one
// did not, and each is the kind that breaks without anything else failing:
//
//   - Enter saves, from any plain field;
//   - the amount's sign is a switch inside it, and a + typed in front flips it;
//   - "Save and add another" clears the fields but keeps the date;
//   - with "Keep the fields" ticked, it keeps them all.
//
// Named "zp-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

async function ready(page: Page): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(async () => {
    const h = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
      .needsSetup as boolean;
    await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify(
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      ),
    });
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({ preferences: { tutorialSeen: true } }),
    });
    let wallets = await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ title: "Sheet", baseCurrency: "EUR" }),
      });
      wallets = await (
        await fetch("/api/v1/wallets", { credentials: "same-origin" })
      ).json();
    }
    const acc = await (
      await fetch(`/api/v1/wallets/${wallets[0].id}/accounts`, {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ name: "Sheet probe", type: "bank" }),
      })
    ).json();
    return acc.id as number;
  });
}

test("the entry sheet saves on Enter, signs by switch, and adds another", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const accountId = await ready(page);
  await page.goto(`/transactions?account=${accountId}`);

  const sheet = page.getByRole("dialog");
  const amount = sheet.getByLabel("Amount", { exact: true });
  const memo = sheet.getByLabel("Memo", { exact: true });
  const date = sheet.getByLabel("Date", { exact: true });
  const open = async () => {
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(amount).toBeFocused();
  };

  await test.step("a + typed in front makes it income, and Enter saves", async () => {
    await open();
    await page.keyboard.type("+20");
    await expect(amount).toHaveValue("20");
    await expect(
      sheet.getByRole("button", { name: "Income — switch to expense" }),
    ).toBeVisible();
    await date.fill("2026-03-10");
    await memo.fill("Sheet income");
    await memo.press("Enter");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("Sheet income")).toBeVisible();
  });

  await test.step("Save and add another clears the fields and keeps the date", async () => {
    await open();
    await amount.fill("5");
    await date.fill("2026-03-11");
    await memo.fill("Sheet first");
    await sheet.getByRole("button", { name: "Save and add another" }).click();
    await expect(page.getByText("Sheet first")).toBeVisible();
    await expect(amount).toHaveValue("");
    await expect(memo).toHaveValue("");
    await expect(date).toHaveValue("2026-03-11");
  });

  await test.step("with Keep the fields ticked, the next one starts as a copy", async () => {
    await sheet.getByLabel("Keep the fields for the next one").check();
    await amount.fill("6");
    await memo.fill("Sheet repeated");
    await sheet.getByRole("button", { name: "Save and add another" }).click();
    await expect(page.getByText("Sheet repeated").first()).toBeVisible();
    await expect(amount).toHaveValue("6");
    await expect(memo).toHaveValue("Sheet repeated");
    // What is on the sheet was just saved, so closing it asks nothing. It used
    // to ask "Discard your changes?" here, about changes already saved.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});
