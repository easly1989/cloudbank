import { expect, test, type Page } from "@playwright/test";

// The AI's savings proposal (#699) on the real server, explained by the
// pretend AI provider in ../server/cmd/e2e-mail: turned on, the proposal comes
// at once; the overview has the short box, AI insights the rows (with reports
// off too), and "Set budget" opens the budget form on Budget at the earlier
// level, saving nothing until the user saves it, which closes the row.
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
    hasText: "You could keep",
  });

test("a category grown lately: the overview, the rows, then Set budget", async ({
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
  const accounts = (await (
    await page.request.get(`${base}/accounts`, { headers: H })
  ).json()) as { id: number; name: string }[];
  const checking = accounts.find((a) => a.name === "Checking")!;
  const takeaway = (await (
    await page.request.post(`${base}/categories`, {
      headers: H,
      data: { name: "Takeaway" },
    })
  ).json()) as { id: number };
  // 20 a month in the nine months before, 60 in the last three.
  for (let i = 1; i <= 12; i++) {
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
        amount: i <= 3 ? -6000 : -2000,
        categoryId: takeaway.id,
      },
    });
    expect(res.ok()).toBe(true);
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
        subscriptions: false,
        savings: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  // The overview: the short box, no rows.
  await expect(async () => {
    await page.goto("/");
    await expect(box(page)).toContainText("Eating out has doubled lately", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(
    box(page).getByRole("button", { name: /^Set a budget/ }),
  ).toHaveCount(0);

  // The model got the category and the amounts, nothing else.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(
    "Takeaway: 60.00 EUR a month lately against 20.00 EUR before (+200%); back to 20.00 EUR keeps 40.00 EUR a month",
  );

  // AI insights, with reports off: the rows.
  await box(page).getByRole("link", { name: "See the details" }).click();
  await expect(page).toHaveURL(/\/insights$/);
  await expect(box(page)).toContainText(
    /\+200%: 60[.,]00 .* a month against 20[.,]00/,
  );

  await box(page)
    .getByRole("button", { name: /^Set a budget of .* for Takeaway$/ })
    .click();
  await expect(page).toHaveURL(/\/budget\?apply=/);
  const each = page.getByRole("textbox", { name: "Each month" });
  await expect(each).toHaveValue(/^20[.,]00$/);
  const budgets = async () =>
    (await (
      await page.request.get(`${base}/budgets?year=0`, { headers: H })
    ).json()) as { categoryId: number; same: number }[];
  expect(
    (await budgets()).find((b) => b.categoryId === takeaway.id),
  ).toBeUndefined();

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await budgets()).find((b) => b.categoryId === takeaway.id)?.same,
    )
    .toBe(-2000);
  const rows = async () =>
    (
      (await (
        await page.request.get(`${base}/insights/proposals`, { headers: H })
      ).json()) as {
        proposals: {
          kind: string;
          basis: { rows: { categoryId: number }[] };
        }[];
      }
    ).proposals
      .filter((p) => p.kind === "savings")
      .flatMap((p) => p.basis.rows.map((r) => r.categoryId));
  await expect.poll(rows).not.toContain(takeaway.id);
});
