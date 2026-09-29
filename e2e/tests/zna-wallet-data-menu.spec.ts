import { expect, test, type Page } from "@playwright/test";

// The wallet's own pages get a menu group (#537). A reader who never shaped the
// menu gets it as the default; one who did keeps their menu, and the pages it
// has never seen arrive hidden, offered by a card until they answer. Named
// "zna-" so it runs after the main journey, whose admin it reuses.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// The default menu before #537, as a reader who customised it saved it.
const V1 = {
  version: 1,
  groups: [
    {
      id: "money",
      labelKey: "nav.group.money",
      entries: [
        "/accounts",
        "/transactions",
        "/templates",
        "/tags",
        "/assignments",
      ].map((to) => ({
        kind: "item",
        to,
      })),
    },
    {
      id: "planning",
      labelKey: "nav.group.planning",
      entries: ["/schedules", "/bills", "/budget", "/goals"].map((to) => ({
        kind: "item",
        to,
      })),
    },
    {
      id: "insights",
      labelKey: "nav.group.insights",
      entries: ["/reports", "/vehicles"].map((to) => ({ kind: "item", to })),
    },
  ],
};

test.use({ viewport: { width: 1440, height: 1000 } });

async function prefs(page: Page, navLayout?: unknown) {
  await page.evaluate(
    async ({ H, navLayout }) => {
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
      let wallets = await (await fetch("/api/v1/wallets")).json();
      if (!Array.isArray(wallets) || wallets.length === 0) {
        await fetch("/api/v1/wallets", {
          method: "POST",
          headers: H,
          body: JSON.stringify({ title: "Menu", baseCurrency: "EUR" }),
        });
        wallets = await (await fetch("/api/v1/wallets")).json();
      }
      // Only the menu changes: the rest stays as the reader left it, so the
      // dashboard keeps the layout it measured and has nothing to save.
      const me = await (await fetch("/api/v1/auth/me")).json();
      const { navLayout: _old, ...rest } = me.preferences ?? {};
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: H,
        body: JSON.stringify({
          preferences: {
            ...rest,
            tutorialSeen: true,
            tourOffers: false,
            ...(navLayout ? { navLayout } : {}),
          },
        }),
      });
    },
    { H, navLayout },
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
}

test("the wallet's pages get a menu group; a customised menu is asked", async ({
  page,
}) => {
  const nav = page.locator("nav").first();
  const notice = page.getByRole("region", { name: "New in the menu" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await test.step("an untouched menu gets Wallet data, and no question", async () => {
    await prefs(page);
    await expect(nav.getByText("Wallet data")).toBeVisible();
    await expect(nav.getByRole("link", { name: "Categories" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Currencies" })).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  // The dashboard saves the heights it measures the first time it lays out.
  // After that, opening it writes nothing: a save racing an answer to the card
  // would put the old menu back.
  await test.step("a dashboard already laid out writes no preference", async () => {
    await page.waitForTimeout(1500);
    const writes: string[] = [];
    const onRequest = (r: { method(): string; url(): string }) => {
      if (r.method() === "PATCH" && r.url().endsWith("/api/v1/auth/me"))
        writes.push(r.url());
    };
    page.on("request", onRequest);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    page.off("request", onRequest);
    expect(writes).toEqual([]);
  });

  await test.step("a customised menu keeps its shape; Show them adds the pages", async () => {
    await prefs(page, V1);
    await expect(nav.getByRole("link", { name: "Tags" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Categories" })).toHaveCount(0);
    await expect(notice).toContainText("Categories, Payees");
    await notice.getByRole("button", { name: "Show them" }).click();
    await expect(notice).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Categories" })).toBeVisible();
    await page.reload();
    await expect(nav.getByRole("link", { name: "Payees" })).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  await test.step("Keep hidden keeps them out, and does not ask again", async () => {
    await prefs(page, V1);
    await notice.getByRole("button", { name: "Keep hidden" }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(notice).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Categories" })).toHaveCount(0);
  });

  // Leave the default menu for the specs after this one.
  await prefs(page);
});
