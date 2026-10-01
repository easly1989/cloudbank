import { expect, test, type Page } from "@playwright/test";

// The schedules calendar (#546). What this guards:
//
//   - a schedule past its date and not registered waits under "Needs you", and
//     can be registered from the sheet with the amount this bill really came to;
//   - a registered occurrence opens the register on its own row;
//   - the old Bills address lands on the page that replaced it.
//
// Named "zr-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const civil = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function seed(page: Page, suffix: string) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const today = new Date();
  const late = new Date(today);
  late.setDate(today.getDate() - 3);
  return page.evaluate(
    async ({ H, suffix, lateDate, todayDate }) => {
      const json = (r: Response) => r.json();
      const post = (url: string, body: unknown) =>
        fetch(url, {
          method: "POST",
          credentials: "same-origin",
          headers: H,
          body: JSON.stringify(body),
        });
      const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
        .needsSetup as boolean;
      await post(
        needsSetup ? "/api/v1/setup" : "/api/v1/auth/login",
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      );
      await fetch("/api/v1/auth/me", {
        method: "PATCH",
        credentials: "same-origin",
        headers: H,
        body: JSON.stringify({
          locale: "en",
          preferences: { tutorialSeen: true, tourOffers: false },
        }),
      });
      let wallets = await json(await fetch("/api/v1/wallets"));
      if (!Array.isArray(wallets) || wallets.length === 0) {
        await post("/api/v1/wallets", {
          title: "Calendar",
          baseCurrency: "EUR",
        });
        wallets = await json(await fetch("/api/v1/wallets"));
      }
      const base = `/api/v1/wallets/${wallets[0].id}`;
      const acc = await json(
        await post(`${base}/accounts`, {
          name: `Bills ${suffix}`,
          type: "bank",
        }),
      );
      const schedule = async (
        name: string,
        amount: number,
        nextDue: string,
      ) => {
        const tpl = await json(
          await post(`${base}/templates`, {
            name,
            accountId: acc.id,
            amount,
          }),
        );
        return json(
          await post(`${base}/schedules`, {
            templateId: tpl.id,
            unit: "month",
            everyN: 1,
            nextDue,
            autoPost: false,
          }),
        );
      };
      await schedule(`Energy ${suffix}`, -7800, lateDate);
      const gym = await schedule(`Gym ${suffix}`, -3900, todayDate);
      await post(`${base}/schedules/${gym.id}/post`, undefined);
      return acc.id as number;
    },
    { H, suffix, lateDate: civil(late), todayDate: civil(today) },
  );
}

test("the calendar shows what is due and registers it", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = String(Date.now()).slice(-6);
  const accountId = await seed(page, suffix);
  const energy = `Energy ${suffix}`;
  const gym = `Gym ${suffix}`;
  const needs = page.getByTestId("schedules-needs-you");

  await test.step("the old Bills address lands on the calendar", async () => {
    await page.goto("/bills");
    await expect(page).toHaveURL(/\/schedules$/);
    await expect(page.getByTestId("schedules-calendar")).toBeVisible();
  });

  await test.step("a late bill waits under Needs you", async () => {
    await expect(needs).toContainText(energy);
    await expect(needs).toContainText("Overdue since");
  });

  await test.step("registered with this month's amount, it leaves the list", async () => {
    const item = needs.getByTestId("needs-item").filter({ hasText: energy });
    await item.getByRole("button", { name: "More" }).click();
    await page
      .getByRole("menuitem", { name: "Change before registering" })
      .click();
    const sheet = page.getByTestId("occurrence-sheet");
    await expect(sheet).toContainText(energy);
    const amount = sheet.getByLabel("Amount");
    await amount.fill("83.40");
    await sheet.getByRole("button", { name: "Register" }).click();
    await expect(sheet).toBeHidden();
    await expect(item).toHaveCount(0);
  });

  await test.step("a registered bill opens the register on its row", async () => {
    // The registered one: early in a month the grid's trailing days can show
    // the next occurrence too.
    await page
      .getByTestId("schedules-calendar")
      .getByRole("button", { name: new RegExp(`^${gym}`) })
      .and(page.locator('[data-state="registered"]'))
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/transactions\\?account=${accountId}&txn=\\d+`),
    );
    await expect(page.getByText(gym).first()).toBeVisible();
  });

  await test.step("the register holds the amount it was registered with", async () => {
    await expect(
      page.getByText("83.40").or(page.getByText("83,40")).first(),
    ).toBeVisible();
  });

  await test.step("every schedule, with its cadence in words", async () => {
    await page.goto("/schedules?view=list");
    const list = page.getByTestId("schedules-list");
    await expect(list).toContainText(energy);
    await expect(list).toContainText(/Monthly, on day \d+/);
  });
});
