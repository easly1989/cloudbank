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

// Each test makes an account of its own: account names are unique, so a second
// "Sheet probe" is refused, and ?account=undefined quietly opens another one.
async function ready(page: Page, name: string): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(async (name) => {
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
        body: JSON.stringify({ name, type: "bank" }),
      })
    ).json();
    return acc.id as number;
  }, name);
}

test("the entry sheet saves on Enter, signs by switch, and adds another", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const accountId = await ready(page, "Sheet probe");
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
    const keep = sheet.getByRole("button", {
      name: "Keep the fields for the next one",
    });
    await keep.click();
    await expect(keep).toHaveAttribute("aria-pressed", "true");
    await amount.fill("6");
    await memo.fill("Sheet repeated");
    // Ticked, the button says what it will do.
    await sheet
      .getByRole("button", { name: "Save and keep", exact: true })
      .click();
    await expect(page.getByText("Sheet repeated").first()).toBeVisible();
    await expect(amount).toHaveValue("6");
    await expect(memo).toHaveValue("Sheet repeated");
    // What is on the sheet was just saved, so closing it asks nothing. It used
    // to ask "Discard your changes?" here, about changes already saved.
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
  });
});

test("editing a row keeps the splits and tags the register does not load", async ({
  page,
}) => {
  // The register's rows come without splits or tags — the list leaves them out
  // for speed. A sheet seeded from the row alone showed a split with no lines
  // and no tags, and saving it wrote exactly that: the split and the tags gone.
  test.setTimeout(120_000);
  const accountId = await ready(page, "Split probe");
  const { walletId, id } = await page.evaluate(async (accountId) => {
    const h = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const post = async (url: string, body: unknown) =>
      (
        await fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: h,
          body: JSON.stringify(body),
        })
      ).json();
    const wallets = await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json();
    const walletId = wallets[0].id as number;
    const base = `/api/v1/wallets/${walletId}`;
    const a = await post(`${base}/categories`, { name: "Split probe A" });
    const b = await post(`${base}/categories`, { name: "Split probe B" });
    const tx = await post(`${base}/transactions`, {
      accountId,
      date: "2026-03-20",
      amount: -900,
      memo: "Split kept",
      tags: ["kept"],
      splits: [
        { categoryId: a.id, amount: -600 },
        { categoryId: b.id, amount: -300 },
      ],
    });
    return { walletId, id: tx.id as number };
  }, accountId);

  await page.goto(`/transactions?account=${accountId}`);
  await page.getByText("Split kept", { exact: true }).dblclick();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("Memo", { exact: true })).toHaveValue(
    "Split kept",
  );
  await sheet.getByLabel("Memo", { exact: true }).fill("Split still kept");
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toHaveCount(0);

  const saved = await page.evaluate(
    async ({ walletId, id }) =>
      (
        await fetch(`/api/v1/wallets/${walletId}/transactions/${id}`, {
          credentials: "same-origin",
        })
      ).json(),
    { walletId, id },
  );
  expect(saved.memo).toBe("Split still kept");
  expect(saved.isSplit).toBe(true);
  expect(saved.splits).toHaveLength(2);
  expect(saved.tags).toEqual(["kept"]);
});

test("the sheet draws its fields where Settings puts them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const accountId = await ready(page, "Layout probe");

  await test.step("moving the date out of view says what it will be", async () => {
    await page.goto("/settings/general");
    const card = page.locator("#entry-fields");
    await card
      .getByRole("radiogroup", { name: "Payee" })
      .getByText("In view")
      .click();
    await card
      .getByRole("radiogroup", { name: "Date" })
      .getByText("More details")
      .click();
    await expect(card.getByText("Date is needed to save")).toBeVisible();
  });

  await test.step("the sheet follows, and the status is a choice of icons", async () => {
    await page.goto(`/transactions?account=${accountId}`);
    await page.getByRole("button", { name: "Add transaction" }).click();
    const sheet = page.getByRole("dialog");
    // In view without opening More details, which a new entry keeps closed.
    await expect(
      sheet.getByRole("button", { name: "More details" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(sheet.getByLabel("Payee", { exact: true })).toBeVisible();
    const cleared = sheet.getByRole("radio", { name: "Cleared" });
    await sheet
      .locator("label")
      .filter({ has: page.getByText("Cleared") })
      .click();
    await expect(cleared).toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Discard" }).click();
  });

  await test.step("restoring the defaults puts it back", async () => {
    await page.goto("/settings/general");
    await page.getByRole("button", { name: "Restore the defaults" }).click();
    await expect(
      page
        .locator("#entry-fields")
        .getByRole("radiogroup", { name: "Payee" })
        .getByRole("radio", {
          name: "More details",
        }),
    ).toBeChecked();
  });
});
