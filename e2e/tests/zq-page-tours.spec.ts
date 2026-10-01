import { expect, test, type Page } from "@playwright/test";

// The page tours (#421). What this guards:
//
//   - a page offers its tour the first time it is opened, and not the second;
//   - every step of every tour points at something real. A step whose element
//     was renamed away is skipped (or, if the element has no size, centred), and
//     both look fine to anyone watching, so only a test sees them;
//   - Settings brings all the offers back;
//   - turning an offered tour down asks, once, whether to skip the others, and
//     "Skip them all" stops every other page offering its own (#501).
//
// Named "zq-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

async function ready(
  page: Page,
  preferences: Record<string, unknown>,
): Promise<number> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  return page.evaluate(
    async ({ H, preferences }) => {
      const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
        .needsSetup as boolean;
      await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: H,
        body: JSON.stringify(
          needsSetup
            ? { username: "admin", email: "a@b.com", password: "supersecret1" }
            : { username: "admin", password: "supersecret1" },
        ),
      });
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        credentials: "same-origin",
        headers: H,
        body: JSON.stringify({ preferences }),
      });
      let wallets = await (
        await fetch("/api/v1/wallets", { credentials: "same-origin" })
      ).json();
      if (!Array.isArray(wallets) || wallets.length === 0) {
        await fetch("/api/v1/wallets", {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify({ title: "Tours", baseCurrency: "EUR" }),
        });
        wallets = await (
          await fetch("/api/v1/wallets", { credentials: "same-origin" })
        ).json();
      }
      // The budget's tour points at its figures and its table, which a
      // wallet shows once it has a budget (#568).
      const wbase = `/api/v1/wallets/${wallets[0].id}`;
      const cats = await (
        await fetch(`${wbase}/categories`, { credentials: "same-origin" })
      ).json();
      let cat = cats.find((c: { name: string }) => c.name === "Tour groceries");
      if (!cat)
        cat = await (
          await fetch(`${wbase}/categories`, {
            method: "POST",
            credentials: "same-origin",
            headers: H,
            body: JSON.stringify({ name: "Tour groceries" }),
          })
        ).json();
      await fetch(`${wbase}/budgets/${cat.id}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: H,
        body: JSON.stringify({ mode: "same", same: -10000 }),
      });
      // The goals' tour points at their figures and their table, which a
      // wallet shows once it has a goal (#572).
      const goals = await (
        await fetch(`${wbase}/goals`, { credentials: "same-origin" })
      ).json();
      if (goals.length === 0)
        await fetch(`${wbase}/goals`, {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify({ name: "Tour goal", targetAmount: 10000 }),
        });
      // The vehicles' tour points at their table, which a wallet shows once
      // it has a vehicle (#574).
      const vehicles = await (
        await fetch(`${wbase}/vehicles`, { credentials: "same-origin" })
      ).json();
      if (vehicles.length === 0)
        await fetch(`${wbase}/vehicles`, {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify({ name: "Tour car", plate: "", notes: "" }),
        });
      const base = `/api/v1/wallets/${wallets[0].id}/accounts`;
      const accounts = await (
        await fetch(base, { credentials: "same-origin" })
      ).json();
      const found = accounts.find(
        (a: { name: string }) => a.name === "Tour probe",
      );
      if (found) return found.id as number;
      const acc = await (
        await fetch(base, {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify({ name: "Tour probe", type: "bank" }),
        })
      ).json();
      // The review's tour points at its two cards, which a wallet with
      // nothing to review replaces with its end (#570): a duplicate pair.
      for (let i = 0; i < 2; i++)
        await fetch(`${wbase}/transactions`, {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify({
            accountId: acc.id,
            date: "2026-09-10",
            amount: -1234,
            memo: "Tour duplicate",
          }),
        });
      return acc.id as number;
    },
    { H, preferences },
  );
}

test("a page offers its tour once, and the ? plays it again", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // Everything seen but the budget's, so only the page under test speaks.
  await ready(page, {
    tutorialSeen: true,
    toursSeen: [
      "dashboard",
      "register",
      "accounts",
      "reports",
      "schedules",
      "goals",
      "vehicles",
      "bankSync",
      "review",
      "settings",
      "data",
    ],
  });
  const offer = page.locator("[data-tour-offer]");
  const card = page.locator("[data-tour-step]");
  const ask = page.locator("[data-tour-skip-ask]");

  await test.step("the first visit offers it", async () => {
    await page.goto("/budget");
    await expect(offer).toContainText("New here? Take the budget tour");
    // The page stays usable under the offer: it is not a dialog.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await offer.getByRole("button", { name: "Show me · 3 steps" }).click();
    await expect(card).toContainText("The answer first");
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card).toContainText("A month or a year");
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card).toContainText("A line per budget");
    await card.getByRole("button", { name: "Done" }).click();
    await expect(card).toHaveCount(0);
  });

  await test.step("the second does not", async () => {
    await page.goto("/budget");
    await expect(page.getByTestId("budget-table")).toBeVisible();
    // Longer than the page is given to settle before an offer is made.
    await page.waitForTimeout(2000);
    await expect(offer).toHaveCount(0);
  });

  await test.step("the ? in the header plays it again", async () => {
    await page.getByRole("button", { name: "Tour of this page" }).click();
    await expect(card).toContainText("The answer first");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    // Left early, but the reader asked for it: no question about the others.
    await expect(ask).toHaveCount(0);
  });

  await test.step("Settings brings every offer back", async () => {
    await page.goto("/settings/general");
    await page.getByRole("button", { name: "Show all tours again" }).click();
    await expect(
      page.getByText("Each page will offer its tour again."),
    ).toBeVisible();
    await page.goto("/budget");
    await expect(offer).toContainText("New here? Take the budget tour");
    await offer.getByRole("button", { name: "No thanks" }).click();
    await expect(offer).toHaveCount(0);
    // Turned down, so it asks about the others; "Just this one" is an answer
    // too, and the question is not asked again.
    await expect(ask).toContainText("Skip the other pages' tours too?");
    await ask.getByRole("button", { name: "Just this one" }).click();
    await expect(ask).toHaveCount(0);
  });
});

test("skipping an offered tour can skip them all", async ({ page }) => {
  test.setTimeout(120_000);
  // Only the budget's and the goals' tours still to offer, and not yet asked.
  await ready(page, {
    tutorialSeen: true,
    tourOffers: true,
    tourSkipAsked: false,
    toursSeen: [
      "dashboard",
      "register",
      "accounts",
      "reports",
      "schedules",
      "vehicles",
      "bankSync",
      "review",
      "settings",
      "data",
    ],
  });
  const offer = page.locator("[data-tour-offer]");
  const card = page.locator("[data-tour-step]");
  const ask = page.locator("[data-tour-skip-ask]");

  await test.step("leaving an offered tour asks", async () => {
    await page.goto("/budget");
    await offer.getByRole("button", { name: "Show me · 3 steps" }).click();
    await expect(card).toContainText("The answer first");
    await card.getByRole("button", { name: "Skip" }).click();
    await expect(card).toHaveCount(0);
    await expect(ask).toContainText("Skip the other pages' tours too?");
    await ask.getByRole("button", { name: "Skip them all" }).click();
    await expect(ask).toHaveCount(0);
  });

  await test.step("no other page offers its tour", async () => {
    await page.goto("/goals");
    await page.waitForLoadState("networkidle");
    // Longer than the page is given to settle before an offer is made.
    await page.waitForTimeout(2000);
    await expect(offer).toHaveCount(0);
    const prefs = await page.evaluate(async () => {
      const me = await (await fetch("/api/v1/auth/me")).json();
      return me.preferences;
    });
    expect(prefs.tourOffers).toBe(false);
    // The ? still plays it.
    await page.getByRole("button", { name: "Tour of this page" }).click();
    await expect(card).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("Settings brings the offers back", async () => {
    await page.goto("/settings/general");
    await page.getByRole("button", { name: "Show all tours again" }).click();
    await expect(
      page.getByText("Each page will offer its tour again."),
    ).toBeVisible();
    await page.goto("/goals");
    await expect(offer).toBeVisible();
  });
});

test("every step of every tour points at something on its page", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const accountId = await ready(page, {
    tutorialSeen: true,
    tourOffers: false,
  });
  // The schedules tour points at the calendar and at what needs the reader,
  // which a wallet shows once it has a schedule (#546).
  await page.evaluate(
    async ({ H, accountId }) => {
      const wallets = await (
        await fetch("/api/v1/wallets", { credentials: "same-origin" })
      ).json();
      const base = `/api/v1/wallets/${wallets[0].id}`;
      const existing = await (
        await fetch(`${base}/schedules`, { credentials: "same-origin" })
      ).json();
      if (existing.length > 0) return;
      const tpl = await (
        await fetch(`${base}/templates`, {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify({
            name: "Tour rent",
            accountId,
            amount: -50000,
          }),
        })
      ).json();
      await fetch(`${base}/schedules`, {
        method: "POST",
        credentials: "same-origin",
        headers: H,
        body: JSON.stringify({
          templateId: tpl.id,
          unit: "month",
          everyN: 1,
          nextDue: new Date().toISOString().slice(0, 10),
          autoPost: false,
        }),
      });
    },
    { H, accountId },
  );
  const pages: [string, string][] = [
    ["dashboard", "/"],
    ["register", `/transactions?account=${accountId}`],
    ["accounts", "/accounts"],
    ["budget", "/budget"],
    ["reports", "/reports"],
    ["schedules", "/schedules"],
    ["goals", "/goals"],
    ["vehicles", "/vehicles"],
    ["bankSync", "/settings/integrations"],
    ["review", "/review"],
    ["settings", "/settings/general"],
    ["data", "/settings/data"],
  ];
  const card = page.locator("[data-tour-step]");
  for (const [tour, url] of pages) {
    await test.step(tour, async () => {
      await page.goto(url);
      await page.locator(`[data-tour-replay="${tour}"]`).click();
      await expect(card).toBeVisible();
      // No step left out for want of its element…
      await expect(card).toHaveAttribute("data-tour-skipped", "0");
      const total = Number(
        (await card.getByText(/^\d+ \/ \d+$/).textContent())!.split("/")[1],
      );
      for (let i = 1; i <= total; i++) {
        await expect(card.getByText(`${i} / ${total}`)).toBeVisible();
        // …and none shown centred because its element has no size.
        await expect(card, `${tour} step ${i}`).not.toHaveAttribute(
          "data-tour-centred",
          /.*/,
        );
        await card
          .getByRole("button", { name: i < total ? "Next" : "Done" })
          .click();
      }
      await expect(card).toHaveCount(0);
    });
  }
});
