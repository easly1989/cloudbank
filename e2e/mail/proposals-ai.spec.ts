import { expect, test, type Page } from "@playwright/test";

// The AI's budget proposal (#698) on the real server, explained by the pretend
// AI provider in ../server/cmd/e2e-mail: turned on, the proposal comes at once;
// on Budget "Apply" opens the budget form filled in and nothing is saved until
// the user saves it, which closes the row; the overview has the short box.
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

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

const box = (page: Page) => page.getByRole("region", { name: "AI suggestion" });
let walletId = 0;
let rentId = 0;

test("turned on, a proposal comes; Apply fills the form and saves nothing", async ({
  page,
}) => {
  await signIn(page);
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
  walletId = wallet.id;
  const base = `/api/v1/wallets/${walletId}`;
  const accounts = (await (
    await page.request.get(`${base}/accounts`, { headers: H })
  ).json()) as {
    id: number;
    name: string;
  }[];
  const checking = accounts.find((a) => a.name === "Checking")!;
  const rent = (await (
    await page.request.post(`${base}/categories`, {
      headers: H,
      data: { name: "Rent" },
    })
  ).json()) as { id: number };
  rentId = rent.id;
  const gym = (await (
    await page.request.post(`${base}/categories`, {
      headers: H,
      data: { name: "Gym" },
    })
  ).json()) as { id: number };
  for (let i = 1; i <= 6; i++) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 4),
    )
      .toISOString()
      .slice(0, 10);
    const res = await page.request.post(`${base}/transactions`, {
      headers: H,
      data: {
        accountId: checking.id,
        date,
        amount: -75000,
        categoryId: rentId,
      },
    });
    expect(res.ok()).toBe(true);
    const fee = await page.request.post(`${base}/transactions`, {
      headers: H,
      data: { accountId: checking.id, date, amount: -3900, categoryId: gym.id },
    });
    expect(fee.ok()).toBe(true);
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
        budgets: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  await expect(async () => {
    await page.goto("/budget");
    await expect(box(page)).toContainText("Your rent comes back every month", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(box(page)).toContainText("No budget, spent on in 6 of 6 months");

  // The model got the category and the amounts, nothing else.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain("Rent: no budget, spent on in 6 of 6 months");
  expect(sent).toContain("proposed 750.00");

  await box(page)
    .getByRole("button", { name: /^Apply .* to Rent$/ })
    .click();
  const each = page.getByRole("textbox", { name: "Each month" });
  await expect(each).toHaveValue(/^750[.,]00$/);
  const budgets = async () =>
    (await (
      await page.request.get(`${base}/budgets?year=0`, { headers: H })
    ).json()) as { categoryId: number; same: number }[];
  expect(
    (await budgets()).find((b) => b.categoryId === rentId),
  ).toBeUndefined();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () => (await budgets()).find((b) => b.categoryId === rentId)?.same,
    )
    .toBe(-75000);
  await expect(box(page).getByRole("button", { name: /to Rent$/ })).toHaveCount(
    0,
  );
  await expect(
    box(page).getByRole("button", { name: /to Gym$/ }),
  ).toBeVisible();
});

test("the overview has the short box, and Later hides it", async ({ page }) => {
  await signIn(page);
  const base = `/api/v1/wallets/${walletId}`;
  const list = async () =>
    (
      (await (
        await page.request.get(`${base}/insights/proposals`, { headers: H })
      ).json()) as {
        proposals: { id: number }[];
      }
    ).proposals;
  await page.goto("/");
  await expect(
    box(page).getByRole("link", { name: "See in Budget" }),
  ).toBeVisible();
  await expect(box(page).getByRole("button", { name: /^Apply/ })).toHaveCount(
    0,
  );
  await box(page).getByRole("button", { name: "Later" }).click();
  await expect(box(page)).toHaveCount(0);
  expect(await list()).toHaveLength(0);
});
