import { expect, test, type Page } from "@playwright/test";

// The AI's goal proposal (#699) on the real server, explained by the pretend
// AI provider in ../server/cmd/e2e-mail: turned on, the proposal comes at once
// on Goals; "Put in" opens the money sheet with the month's share and "Move the
// date" the goal with the month its pace gets there, saving nothing until the
// user saves, which closes the row.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

// Proposals come from 07:00 on the 1st, in the reader's time zone: on the 1st
// before 07:00 UTC the test reads where it is later already.
const now = new Date();
const TZ =
  now.getUTCDate() === 1 && now.getUTCHours() < 7
    ? "Pacific/Kiritimati"
    : "UTC";
test.use({ timezoneId: TZ });

const box = (page: Page) =>
  page.getByRole("region", { name: "AI suggestion" }).filter({
    hasText: "to look at",
  });

// A civil date d days into the month m months from this one.
const date = (m: number, d: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, d))
    .toISOString()
    .slice(0, 10);

test("goals behind: Put in, then Move the date", async ({ page }) => {
  expect(
    (
      await page.request.post("/api/v1/auth/login", { headers: H, data: USER })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put("/api/v1/notifications/settings", {
        headers: H,
        data: { timezone: TZ },
      })
    ).ok(),
  ).toBe(true);
  const [wallet] = (await (
    await page.request.get("/api/v1/wallets", { headers: H })
  ).json()) as { id: number }[];
  const base = `/api/v1/wallets/${wallet.id}`;
  const accounts = (await (
    await page.request.get(`${base}/accounts`, { headers: H })
  ).json()) as { id: number; name: string }[];
  const checking = accounts.find((a) => a.name === "Checking")!;
  // Two months ago, enough kept that the trip's share fits and the house's
  // does not, whatever the other specs left.
  expect(
    (
      await page.request.post(`${base}/transactions`, {
        headers: H,
        data: { accountId: checking.id, date: date(-2, 3), amount: 3000000 },
      })
    ).ok(),
  ).toBe(true);

  // 100 a month in each of the last three months.
  const goal = async (
    name: string,
    targetAmount: number,
    by: string | null,
    each: number,
  ) => {
    const g = (await (
      await page.request.post(`${base}/goals`, {
        headers: H,
        data: { name, targetAmount, targetDate: by },
      })
    ).json()) as { id: number };
    for (let m = 1; m <= 3; m++) {
      const res = await page.request.post(
        `${base}/goals/${g.id}/contributions`,
        {
          headers: H,
          data: { date: date(-m, 10), amount: each, note: "" },
        },
      );
      expect(res.ok()).toBe(true);
    }
    return g.id;
  };
  // 1500 left in six months: 250 a month against 100.
  const trip = await goal("Trip", 180000, date(7, 0), 10000);
  // 83084 a month, far more than is kept.
  const house = await goal("House", 100000000, date(13, 0), 100000);
  await goal("Fund", 120000, null, 10000);

  const res = await page.request.put("/api/v1/ai/settings", {
    headers: H,
    data: {
      enabled: true,
      baseUrl: `${FAKE}/v1`,
      model: "pretend",
      features: {
        suggest: false,
        entry: false,
        mail: true,
        reports: false,
        budgets: false,
        subscriptions: false,
        savings: false,
        goals: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  await expect(async () => {
    await page.goto("/goals");
    await expect(box(page)).toContainText("Your trip is behind its date", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(box(page)).toContainText("3 goals to look at");

  // The model got the goals and the amounts.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain("Trip: 1500.00 EUR left by");
  expect(sent).toContain(
    "needs 250.00 EUR a month, goes in at 100.00 EUR a month",
  );
  expect(sent).toContain("House: 997000.00 EUR left by");
  expect(sent).toContain("Fund: no date, 900.00 EUR left");

  type Row = { goalId: number; reason: string; newDate?: string };
  const rows = async () =>
    (
      (await (
        await page.request.get(`${base}/insights/proposals`, { headers: H })
      ).json()) as { proposals: { kind: string; basis: { rows: Row[] } }[] }
    ).proposals
      .filter((p) => p.kind === "goals")
      .flatMap((p) => p.basis.rows);
  expect((await rows()).map((r) => r.reason)).toEqual(["late", "move", "eta"]);

  // Put in: the month's share filled in, nothing saved until Put in.
  await box(page)
    .getByRole("button", { name: /^Put .* into Trip$/ })
    .click();
  const money = page.getByTestId("goal-money-sheet");
  await expect(money.getByRole("textbox", { name: "Amount" })).toHaveValue(
    /^250[.,]00$/,
  );
  await money.getByRole("button", { name: "Put in", exact: true }).click();
  await expect(money).toBeHidden();
  await expect
    .poll(async () => (await rows()).map((r) => r.goalId))
    .not.toContain(trip);

  // Move the date: the goal with the month its pace gets there.
  const newDate = (await rows()).find((r) => r.goalId === house)!.newDate!;
  await box(page)
    .getByRole("button", { name: /^Move the date of House to / })
    .click();
  const sheet = page.getByTestId("goal-sheet");
  await expect(sheet.getByLabel("By")).toHaveValue(newDate);
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => (await rows()).map((r) => r.goalId))
    .not.toContain(house);
  const goals = (await (
    await page.request.get(`${base}/goals`, { headers: H })
  ).json()) as { id: number; targetDate: string | null }[];
  expect(goals.find((g) => g.id === house)?.targetDate).toBe(newDate);
});
