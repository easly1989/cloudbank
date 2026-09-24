import { expect, test, type Page } from "@playwright/test";

// The register is usable without a pointer (#446).
//
// Every step here is a key press. The register is where CloudBank asks the most
// of a keyboard: a focusable ledger with its own cursor, an entry sheet that
// opens over it, a confirmation that can open over that, and a column panel
// whose drag has a button alternative (WCAG 2.5.7). Each of those has broken
// quietly before — a sheet that did not hand focus back, a confirmation under
// its drawer — and a mouse-driven test walks straight past all of them.
//
// Named "zo-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const MEMO = "Keyboard probe";

async function ready(page: Page): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(async (memo) => {
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
    // Suppress the first-login tour; its backdrop swallows every key.
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({
        preferences: { tutorialSeen: true, tourOffers: false },
      }),
    });
    let wallets = await (
      await fetch("/api/v1/wallets", { credentials: "same-origin" })
    ).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ title: "Keyboard", baseCurrency: "EUR" }),
      });
      wallets = await (
        await fetch("/api/v1/wallets", { credentials: "same-origin" })
      ).json();
    }
    const wid = wallets[0].id as number;
    // An account of its own holding one ordinary expense, so the first row
    // under the cursor is known — and is not a transfer, whose sheet has no
    // unsaved-edits guard.
    const acc = await (
      await fetch(`/api/v1/wallets/${wid}/accounts`, {
        method: "POST",
        credentials: "same-origin",
        headers: h,
        body: JSON.stringify({ name: `${memo} account`, type: "bank" }),
      })
    ).json();
    await fetch(`/api/v1/wallets/${wid}/transactions`, {
      method: "POST",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({
        accountId: acc.id,
        date: "2026-03-01",
        amount: -1234,
        memo,
      }),
    });
    return acc.id as number;
  }, MEMO);
}

test.describe.configure({ mode: "serial" });

test("the register, its entry sheet and its confirmation work from the keyboard", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const accountId = await ready(page);
  await page.goto(`/transactions?account=${accountId}`);

  const ledger = page.getByRole("region", { name: "Account ledger" });
  const sheet = page.getByRole("dialog");
  const memo = sheet.getByLabel("Memo", { exact: true });

  await test.step("the ledger shows that it has focus", async () => {
    await ledger.focus();
    // It used to set outline: none, so arriving by keyboard showed nothing.
    const outline = await ledger.evaluate((el) =>
      el.matches(":focus-visible")
        ? getComputedStyle(el).outlineStyle
        : "not focus-visible",
    );
    expect(outline).toBe("solid");
  });

  await test.step("down, Enter opens the row; Escape closes it and focus comes back", async () => {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(memo).toHaveValue(MEMO);
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    // Back where the reader left off, so the next arrow key still moves the
    // cursor instead of scrolling the page.
    await expect(ledger).toBeFocused();
  });

  await test.step("a confirmation is answered from the keyboard", async () => {
    await page.keyboard.press("Enter");
    await memo.fill("edited, never saved");
    await page.keyboard.press("Escape");

    const confirm = page.getByRole("dialog", {
      name: "Discard your changes?",
    });
    const discard = confirm.getByRole("button", {
      name: "Discard",
      exact: true,
    });
    const keep = confirm.getByRole("button", { name: "Keep editing" });
    await expect(discard).toBeFocused();

    // Keep editing: the confirmation goes, the sheet and the edit stay.
    await page.keyboard.press("Shift+Tab");
    await expect(keep).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(confirm).toHaveCount(0);
    await expect(memo).toHaveValue("edited, never saved");

    // Discard: both go, and the edit is gone with them.
    await page.keyboard.press("Escape");
    await expect(discard).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await ledger.focus();
    await page.keyboard.press("Enter");
    await expect(memo).toHaveValue(MEMO);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  await test.step("a column moves with its buttons, not only by dragging", async () => {
    const columns = page.getByRole("button", { name: "Columns" });
    await columns.focus();
    await page.keyboard.press("Enter");
    await expect(columns).toHaveAttribute("aria-pressed", "true");

    const dateLeft = page.getByRole("button", { name: "Move Date left" });
    const dateRight = page.getByRole("button", { name: "Move Date right" });
    // Date is first, so it cannot go further left.
    await expect(dateLeft).toBeDisabled();

    await dateRight.focus();
    await page.keyboard.press("Enter");
    await expect(dateLeft).toBeEnabled();

    // The order is saved to the user's preferences; put it back, by keyboard
    // too, so the suites after this one see the register they expect.
    await page.getByRole("button", { name: "Reset", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(dateLeft).toBeDisabled();
  });
});
