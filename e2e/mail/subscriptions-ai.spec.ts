import { expect, test, type Page } from "@playwright/test";

// The AI's subscription proposal (#699) on the real server, explained by the
// pretend AI provider in ../server/cmd/e2e-mail: turned on, the proposal comes
// at once; on Schedules "Update" opens the schedule with the new amount filled
// in and nothing is saved until the user saves it, which closes the row.
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
    hasText: "subscription",
  });

test("a raised schedule: Update fills the new amount and saves nothing", async ({
  page,
}) => {
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
  const post = async <T>(path: string, data: object) => {
    const res = await page.request.post(base + path, { headers: H, data });
    expect(res.ok()).toBe(true);
    return (await res.json()) as T;
  };
  const accounts = (await (
    await page.request.get(`${base}/accounts`, { headers: H })
  ).json()) as { id: number; name: string }[];
  const checking = accounts.find((a) => a.name === "Checking")!;
  const payee = await post<{ id: number }>("/payees", { name: "Streamflix" });
  const template = await post<{ id: number }>("/templates", {
    name: "Streamflix",
    accountId: checking.id,
    amount: -1299,
    payeeId: payee.id,
  });
  const day = (monthsBack: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 5))
      .toISOString()
      .slice(0, 10);
  const schedule = await post<{ id: number }>("/schedules", {
    templateId: template.id,
    unit: "month",
    everyN: 1,
    nextDue: day(-1),
    autoPost: false,
  });
  // Paid as saved, then twice at the new price.
  for (const [back, amount] of [
    [4, -1299],
    [3, -1299],
    [2, -1599],
    [1, -1599],
  ]) {
    await post("/transactions", {
      accountId: checking.id,
      date: day(back),
      amount,
      payeeId: payee.id,
    });
  }

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
        subscriptions: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  await expect(async () => {
    await page.goto("/schedules?view=list");
    await expect(box(page)).toContainText("Your streaming now costs more", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(box(page)).toContainText(
    /Raised: the last 2 payments were 15[.,]99/,
  );

  // The model got the schedule and its amounts, nothing else.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(
    "Streamflix: saved at 12.99 EUR, the last 2 payments were 15.99 EUR and 15.99 EUR",
  );

  await box(page)
    .getByRole("button", { name: /^Update Streamflix to/ })
    .click();
  const sheet = page.getByTestId("schedule-sheet");
  await expect(sheet.getByRole("textbox", { name: "Amount" })).toHaveValue(
    /^15[.,]99$/,
  );
  const saved = async () =>
    (
      (await (
        await page.request.get(`${base}/schedules`, { headers: H })
      ).json()) as { id: number; templateAmount: number }[]
    ).find((s) => s.id === schedule.id)?.templateAmount;
  expect(await saved()).toBe(-1299);

  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(saved).toBe(-1599);
  await expect(box(page)).toHaveCount(0);
});
