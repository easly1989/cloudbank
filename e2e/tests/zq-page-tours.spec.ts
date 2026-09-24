import { expect, test, type Page } from "@playwright/test";

// The page tours (#421). What this guards:
//
//   - a page offers its tour the first time it is opened, and not the second;
//   - every step of every tour points at something real. A step whose element
//     was renamed away is skipped (or, if the element has no size, centred), and
//     both look fine to anyone watching, so only a test sees them;
//   - Settings brings all the offers back.
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
      "bills",
      "goals",
      "bankSync",
      "review",
      "settings",
      "data",
    ],
  });
  const offer = page.locator("[data-tour-offer]");
  const card = page.locator("[data-tour-step]");

  await test.step("the first visit offers it", async () => {
    await page.goto("/budget");
    await expect(offer).toContainText("New here? Take the budget tour");
    // The page stays usable under the offer: it is not a dialog.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await offer.getByRole("button", { name: "Show me · 2 steps" }).click();
    await expect(card).toContainText("Plan, then compare");
    await card.getByRole("button", { name: "Next" }).click();
    await expect(card).toContainText("An amount per category");
    await card.getByRole("button", { name: "Done" }).click();
    await expect(card).toHaveCount(0);
  });

  await test.step("the second does not", async () => {
    await page.goto("/budget");
    await expect(page.getByRole("tab", { name: "Report" })).toBeVisible();
    // Longer than the page is given to settle before an offer is made.
    await page.waitForTimeout(2000);
    await expect(offer).toHaveCount(0);
  });

  await test.step("the ? in the header plays it again", async () => {
    await page.getByRole("button", { name: "Tour of this page" }).click();
    await expect(card).toContainText("Plan, then compare");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
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
  const pages: [string, string][] = [
    ["dashboard", "/"],
    ["register", `/transactions?account=${accountId}`],
    ["accounts", "/accounts"],
    ["budget", "/budget"],
    ["reports", "/reports"],
    ["schedules", "/schedules"],
    ["bills", "/bills"],
    ["goals", "/goals"],
    ["bankSync", "/bank-sync"],
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
