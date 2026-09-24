import { expect, test, type Page } from "@playwright/test";

// An edit modal must show the record it was opened on.
//
// That sounds too obvious to test, and it is exactly what broke: these forms
// used to be reset by an effect that fired after the modal was already on
// screen, and replacing those effects with a per-opening mount is easy to get
// half right — one field left initialised to "" and the modal opens blank on
// every record, which typechecks, lints and passes every other test.
//
// Named "zm-" so it runs after the main journey (smoke.spec.ts), whose admin it
// reuses; like the responsive suite it also sets itself up when run alone.

const PREFIX = "Modal";

async function ensureReady(page: Page): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const walletId = await page.evaluate(async () => {
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
    // Suppress the first-login tour; its backdrop swallows every click.
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
        body: JSON.stringify({ title: "Modals", baseCurrency: "EUR" }),
      });
      wallets = await (
        await fetch("/api/v1/wallets", { credentials: "same-origin" })
      ).json();
    }
    return wallets[0].id as number;
  });
  return walletId;
}

// seed creates the records through the API: this suite is about what the modal
// shows, not about how the records got there.
async function seed(
  page: Page,
  walletId: number,
  path: string,
  bodies: object[],
) {
  await page.evaluate(
    async ([url, list]) => {
      for (const body of list as object[]) {
        await fetch(url as string, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(body),
        });
      }
    },
    [`/api/v1/wallets/${walletId}/${path}`, bodies] as const,
  );
}

// A required Mantine field puts its asterisk inside the label, so the
// accessible name is "Account name *" and an exact match on the bare label
// misses it. Try both rather than matching loosely, which would let "Name"
// find "Account name".
async function field(page: Page, label: string) {
  const dialog = page.getByRole("dialog");
  const exact = dialog.getByLabel(label, { exact: true });
  if (await exact.count()) return exact.first();
  return dialog.getByLabel(`${label} *`, { exact: true }).first();
}

test.describe.configure({ mode: "serial" });

test("an edit modal opens on its own record, twice running, and blank for a new one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const walletId = await ensureReady(page);

  const accounts = [`${PREFIX} Alpha`, `${PREFIX} Beta`];
  const templates = [`${PREFIX} Rent`, `${PREFIX} Salary`];
  await seed(
    page,
    walletId,
    "accounts",
    accounts.map((name) => ({ name, type: "bank" })),
  );
  await seed(
    page,
    walletId,
    "templates",
    templates.map((name) => ({ name })),
  );

  await test.step("accounts", async () => {
    await page.goto("/accounts");
    for (const name of accounts) {
      await page
        .getByRole("row", { name: new RegExp(name) })
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await expect(await field(page, "Account name")).toHaveValue(name);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Add account" }).click();
    await expect(await field(page, "Account name")).toHaveValue("");
    await page.keyboard.press("Escape");
  });

  await test.step("templates", async () => {
    await page.goto("/templates");
    for (const name of templates) {
      await page
        .getByRole("row", { name: new RegExp(name) })
        .getByRole("button", { name: "Edit template" })
        .click();
      await expect(await field(page, "Name")).toHaveValue(name);
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Add template" }).click();
    await expect(await field(page, "Name")).toHaveValue("");
    await page.keyboard.press("Escape");
  });
});

// A confirmation raised from inside a drawer has to be clickable.
//
// It was not (#462): Mantine places each modal in a shared portal node when it
// mounts, the confirmation mounts with the app and the entry drawer after it,
// and at equal z-index the later one paints on top — so "Discard your changes?"
// came up underneath the drawer with its Discard button covered. A click here
// is a real pointer click on purpose: a dispatched event reaches a covered
// button just fine, which is exactly how this went unnoticed.
test("the discard confirmation sits above the entry drawer", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const walletId = await ensureReady(page);

  const memo = `${PREFIX} discard probe`;
  await page
    .evaluate(
      async ([wid, text]) => {
        const h = {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        };
        const acc = await (
          await fetch(`/api/v1/wallets/${wid}/accounts`, {
            method: "POST",
            credentials: "same-origin",
            headers: h,
            body: JSON.stringify({ name: `${text} account`, type: "bank" }),
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
            memo: text,
          }),
        });
        return acc.id as number;
      },
      [walletId, memo] as const,
    )
    .then((accountId) => page.goto(`/transactions?account=${accountId}`));

  await page.getByText(memo, { exact: true }).first().dblclick();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Memo", { exact: true }).fill("edited, never saved");
  await page.keyboard.press("Escape");

  await expect(page.getByText("Discard your changes?")).toBeVisible();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // And the edit really was thrown away.
  await page.getByText(memo, { exact: true }).first().dblclick();
  await expect(
    page.getByRole("dialog").getByLabel("Memo", { exact: true }),
  ).toHaveValue(memo);
});
