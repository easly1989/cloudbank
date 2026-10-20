import { expect, type Page, test } from "@playwright/test";

// Quick add from the phone (#702): the manifest's shortcuts, named in the
// reader's language, open the entry sheet with the sign set; text shared from
// another app opens it with the text on top, and nothing is saved until Save.
// On a wallet of its own; named "zrc-" so it runs after the main journey, whose
// admin it reuses, and it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

async function setUp(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h }) => {
      const call = async (method: string, url: string, body?: unknown) => {
        const r = await fetch(url, {
          method,
          headers: h,
          body: body ? JSON.stringify(body) : undefined,
        });
        return r.status === 204 ? null : r.json();
      };
      const needsSetup = (await call("GET", "/api/v1/setup/status"))
        .needsSetup as boolean;
      await call(
        "POST",
        needsSetup ? "/api/v1/setup" : "/api/v1/auth/login",
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      );
      const me = await call("GET", "/api/v1/auth/me");
      const w = await call("POST", "/api/v1/wallets", {
        title: `Quick add ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
      });
      const card = await call("POST", `${base}/accounts`, {
        name: "Card",
        type: "checking",
      });
      // Card is the default account: a new entry from outside starts there.
      await call("PATCH", "/api/v1/auth/me", {
        preferences: {
          ...(me.preferences ?? {}),
          tutorialSeen: true,
          tourOffers: false,
          defaultAccountId: card.id,
        },
      });
      return { wallet: w.id as number, base, card: card.id as number };
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("the manifest names its shortcuts in the reader's language", async ({
  request,
}) => {
  const manifest = async (lang: string) =>
    (
      await request.get("/manifest.webmanifest", {
        headers: { "Accept-Language": lang },
      })
    ).json();
  const en = await manifest("en-US,en;q=0.9");
  expect(en.shortcuts.map((s: { name: string }) => s.name)).toEqual([
    "New expense",
    "New income",
  ]);
  expect(en.share_target).toMatchObject({
    action: "/transactions",
    method: "GET",
  });
  const it = await manifest("it-IT,it;q=0.9");
  expect(it.shortcuts.map((s: { name: string }) => s.name)).toEqual([
    "Nuova spesa",
    "Nuova entrata",
  ]);
  expect(it.shortcuts[1].url).toBe("/transactions?new=1&kind=income");
});

test("a shortcut opens the sheet on the default account with the sign set", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await setUp(page);
  await page.goto("/transactions?new=1&kind=income");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Income — switch to expense" }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("combobox", { name: "Account", exact: true }),
  ).toHaveValue("Card");
});

test("shared text opens the sheet with the text, and saves nothing by itself", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await setUp(page);
  const text =
    "Card payment of 12.50 EUR at Corner Bakery on 20/10. Not you? Call us.";
  await page.goto(
    `/transactions?title=${encodeURIComponent("My bank")}&text=${encodeURIComponent(text)}`,
  );
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Shared text", { exact: true })).toBeVisible();
  await expect(
    sheet.getByText(/My bank\s+Card payment of 12\.50 EUR/),
  ).toBeVisible();
  // Nothing is guessed without the AI.
  await expect(
    sheet.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveValue("");
  // The shared text leaves the address once the sheet closes, with nothing saved.
  await sheet
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).not.toHaveURL(/text=/);
  const rows = await page.evaluate(
    async ({ base, card }) =>
      (
        await (
          await fetch(`${base}/transactions/register?accountId=${card}`)
        ).json()
      ).rows,
    ids,
  );
  expect(rows).toHaveLength(0);
});
