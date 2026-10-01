import { type Page, expect, test } from "@playwright/test";

// The Goals page (#572): what is set aside, the month's share against the
// pace, what is left free; a row per goal, reached ones waiting to be closed,
// the history folded away. Closing, giving up and reopening; money that
// reaches the target closes the goal with it. Outside the page, the accounts
// say what they hold for goals and the overview asks for reached goals to be
// closed. On a wallet of its own, seeded here.
// Named "zqk-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const monthDay = (back: number, day: number) => {
  const i = now.getFullYear() * 12 + now.getMonth() - back;
  return `${Math.floor(i / 12)}-${pad((i % 12) + 1)}-${pad(day)}`;
};

async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, dates }) => {
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
      await call("PATCH", "/api/v1/auth/me", {
        preferences: {
          ...(me.preferences ?? {}),
          tutorialSeen: true,
          tourOffers: false,
        },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Goals ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const savings = await call("POST", `${base}/accounts`, {
        name: "Savings",
        type: "savings",
        initialBalance: 1000000,
      });
      const cash = await call("POST", `${base}/accounts`, {
        name: "Cash",
        type: "cash",
        initialBalance: 30000,
      });
      const goal = async (
        name: string,
        targetAmount: number,
        moves: [string, number][],
        extra: Record<string, unknown> = {},
      ) => {
        const g = await call("POST", `${base}/goals`, {
          name,
          targetAmount,
          note: "",
          ...extra,
        });
        for (const [date, amount] of moves)
          await call("POST", `${base}/goals/${g.id}/contributions`, {
            date,
            amount,
            note: "",
          });
        return g.id as number;
      };
      // 500 in over the last three months, 1.800 by five months on: 260 a
      // month needed, 167 a month lately. Kept in Cash, which holds 300.
      const trip = await goal(
        "Summer trip",
        180000,
        [
          [dates.m3, 15000],
          [dates.m2, 15000],
          [dates.m1, 20000],
        ],
        { targetDate: dates.trip, accountId: cash.id },
      );
      const fund = await goal("Rainy-day fund", 500000, [[dates.m8, 160000]], {
        accountId: savings.id,
      });
      const tickets = await goal("Concert tickets", 12000, [
        [dates.m2, 6000],
        [dates.m1, 6000],
      ]);
      const bike = await goal("New bike", 60000, [[dates.m5, 60000]]);
      await call("POST", `${base}/goals/${bike}/close`, { date: dates.m3 });
      return {
        wallet: w.id as number,
        base,
        trip,
        fund,
        tickets,
        bike,
        savings: savings.id as number,
        cash: cash.id as number,
      };
    },
    {
      h: H,
      dates: {
        m1: monthDay(1, 15),
        m2: monthDay(2, 15),
        m3: monthDay(3, 15),
        m5: monthDay(5, 15),
        m8: monthDay(8, 15),
        trip: monthDay(-5, 1),
      },
    },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    ids.wallet,
  );
  return ids;
}

test("goals: figures, rows, closing, giving up, reopening and the history", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const ids = await seed(page);
  await page.goto("/goals");
  const table = page.getByTestId("goals-table");
  const row = (id: number) => page.getByTestId(`goal-row-${id}`);
  const fold = page.getByTestId("goals-history-fold");
  // The confirmation, apart from a sheet that may be open under it.
  const ask = (text: string) =>
    page.getByRole("dialog").filter({ hasText: text });

  await test.step("the figures count what is still set aside", async () => {
    // Trip 500 + fund 1.600 + tickets 120; the closed bike does not count.
    await expect(page.getByTestId("goals-saved")).toContainText(
      /2[.,]?220[,.]00/,
    );
    await expect(page.getByText(/across 3 goals/)).toBeVisible();
    await expect(page.getByTestId("goals-monthly")).toContainText(/260[,.]00/);
    await expect(
      page.getByText(/you put in 167[,.]00 . a month lately/),
    ).toBeVisible();
    // 10.300 in the wallet, less 2.220.
    await expect(page.getByTestId("goals-free")).toContainText(
      /8[.,]?080[,.]00/,
    );
  });

  await test.step("a row per goal; reached ones apart; the history folded", async () => {
    await expect(row(ids.trip)).toContainText(/260[,.]00 . a month needed/);
    await expect(row(ids.trip)).toContainText("5 months to go");
    await expect(row(ids.fund)).toContainText("Savings");
    await expect(row(ids.tickets)).toContainText("Close it when you are done");
    await expect(fold).toContainText("1 goal, closed");
    await expect(row(ids.bike)).toHaveCount(0);
    await fold.click();
    await expect(row(ids.bike)).toContainText("Reached · closed");
  });

  await test.step("Close on a reached goal moves it to the history", async () => {
    await row(ids.tickets).getByRole("button", { name: "Close" }).click();
    await ask("Close Concert tickets?")
      .getByRole("button", { name: "Close goal" })
      .click();
    await expect(fold).toContainText("2 goals, closed");
    await expect(row(ids.tickets)).toContainText("Reached · closed");
    await expect(page.getByTestId("goals-saved")).toContainText(
      /2[.,]?100[,.]00/,
    );
  });

  await test.step("money that reaches the target closes the goal with it", async () => {
    await row(ids.trip).getByRole("button", { name: "Put in" }).click();
    const sheet = page.getByTestId("goal-money-sheet");
    // It starts from this month's share.
    await expect(sheet.getByLabel("Amount")).toHaveValue(/260[,.]00/);
    await sheet.getByLabel("Amount").fill("1300");
    await expect(sheet).toContainText("This reaches the target");
    await expect(
      sheet.getByLabel("Close the goal once it is in"),
    ).toBeChecked();
    await sheet.getByRole("button", { name: "Put in and close" }).click();
    await expect(sheet).toBeHidden();
    await expect(fold).toContainText("3 goals, closed");
    await expect(row(ids.trip)).toContainText("Reached · closed");
  });

  await test.step("reopened, a reached goal waits to be closed again", async () => {
    await row(ids.trip)
      .getByRole("button", { name: "Actions for Summer trip" })
      .click();
    await page.getByRole("menuitem", { name: "Reopen goal" }).click();
    await expect(fold).toContainText("2 goals, closed");
    await expect(row(ids.trip)).toContainText("Close it when you are done");
  });

  await test.step("giving up closes an open goal at what it got to", async () => {
    await row(ids.fund)
      .getByRole("button", { name: "Actions for Rainy-day fund" })
      .click();
    await page.getByRole("menuitem", { name: "Give up" }).click();
    const confirm = ask("Give up on Rainy-day fund?");
    await expect(confirm).toContainText("32%");
    await confirm.getByRole("button", { name: "Give up" }).click();
    await expect(row(ids.fund)).toContainText(/Given up · closed .*, at 32%/);
  });

  await test.step("a closed goal's money stays put until it is reopened", async () => {
    await row(ids.fund).click();
    const sheet = page.getByTestId("goal-sheet");
    await expect(sheet).toContainText("reopen it to change its money");
    await expect(sheet.getByRole("button", { name: "Put in" })).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: "Delete this movement" }),
    ).toHaveCount(0);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
  });

  await test.step("a movement is deleted after asking", async () => {
    await row(ids.trip).click();
    const sheet = page.getByTestId("goal-sheet");
    const moves = sheet.getByTestId("goal-moves");
    await expect(
      moves.getByRole("button", { name: "Delete this movement" }),
    ).toHaveCount(4);
    await moves
      .getByRole("button", { name: "Delete this movement" })
      .first()
      .click();
    await ask("Delete this movement?")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await expect(
      moves.getByRole("button", { name: "Delete this movement" }),
    ).toHaveCount(3);
    await sheet.getByRole("button", { name: "Cancel" }).click();
  });
  await expect(table).toBeVisible();
});

test("goals outside the page: accounts, the register and the overview", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const ids = await seed(page);

  await test.step("an account says what it holds for goals, amber when short", async () => {
    await page.goto("/accounts");
    await expect(
      page.getByTestId(`account-aside-${ids.savings}`),
    ).toContainText(/1[.,]?600[,.]00 . set aside for goals$/);
    const cash = page.getByTestId(`account-aside-${ids.cash}`);
    await expect(cash).toContainText("more than it holds");
    await expect(cash).toHaveAttribute("data-short", "true");
  });

  await test.step("the register shows it beside the balances", async () => {
    await page.goto(`/transactions?account=${ids.cash}`);
    const fig = page.getByTestId("register-goals");
    await expect(fig).toContainText("Set aside for goals");
    await expect(fig).toContainText(
      /Summer trip · 200[,.]00 . more than the account holds/,
    );
  });

  await test.step("the overview asks for the reached goal to be closed", async () => {
    await page.goto("/");
    const strip = page.locator(".cb-attention");
    await expect(strip).toContainText("goal reached its target");
    await strip.getByRole("link", { name: "Review goals" }).click();
    await expect(page).toHaveURL(/\/goals$/);
  });
});
