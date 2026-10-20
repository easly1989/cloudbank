import { expect, test, type Page } from "@playwright/test";

// The AI's unusual transactions (#700) on the real server, explained by the
// pretend AI provider in ../server/cmd/e2e-mail. Imported expenses are news to
// the reader: turned on, the last 30 days are flagged without telling; a new
// one reaches the bell and opens in the register; a double charge leads to its
// pair on Review; "It's fine" puts a flag away.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider,
// and last, so its flags meet no other spec's bell.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

const now = new Date();
const TZ = "UTC";
test.use({ timezoneId: TZ });

const box = (page: Page) =>
  page.getByRole("region", { name: "AI suggestion" }).filter({
    hasText: /\d+ unusual transactions?/,
  });

// A civil date d days from today.
const day = (d: number) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d),
  )
    .toISOString()
    .slice(0, 10);

test("flags, the bell, the pair, and It's fine", async ({ page }) => {
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
  const importRows = async (
    rows: { date: string; amount: number; payee: string }[],
  ) => {
    const res = await page.request.post(`${base}/import/commit`, {
      headers: H,
      data: { accountId: checking.id, rows },
    });
    expect(res.ok()).toBe(true);
  };

  // 60 a month to the power company, then 180; a cinema club charged twice.
  await importRows([
    ...[200, 170, 140, 110, 80].map((d) => ({
      date: day(-d),
      amount: -6000,
      payee: "Power company",
    })),
    { date: day(-5), amount: -18000, payee: "Power company" },
    { date: day(-3), amount: -1200, payee: "Cinema club" },
    { date: day(-2), amount: -1200, payee: "Cinema club" },
  ]);

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
        goals: false,
        unusual: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  // Review: the box on top, with the model's sentence and the rows.
  await expect(async () => {
    await page.goto("/review");
    await expect(box(page)).toContainText(
      "Your power bill is three times the usual",
      {
        timeout: 2_000,
      },
    );
  }).toPass({ timeout: 30_000 });
  await expect(box(page)).toContainText(
    /3 times the usual: usually .*60.* \(5 payments in the last year\)/,
  );
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(
    "Power company, " +
      day(-5) +
      ": 180.00 EUR; usually (median) 60.00 EUR over 5 payments",
  );
  expect(sent).toContain(
    "Cinema club: 12.00 EUR charged twice, on " + day(-3) + " and " + day(-2),
  );

  // See the pair: the possible duplicate, in view.
  await box(page)
    .getByRole("button", {
      name: "See the pair of Cinema club among the possible duplicates",
    })
    .click();
  const pair = page.locator('[id^="pair-"]').filter({ hasText: "Cinema club" });
  await expect(pair).toBeInViewport();

  // The first look told nobody.
  type Item = { title: string; url: string };
  const bell = async () =>
    (
      (await (
        await page.request.get("/api/v1/notifications", { headers: H })
      ).json()) as {
        items: Item[];
      }
    ).items.filter((i) => i.title === "Unusual transaction");
  expect(await bell()).toHaveLength(0);

  // A new one is told, and opens in the register.
  await importRows([{ date: day(0), amount: -20000, payee: "Power company" }]);
  await expect
    .poll(async () => (await bell()).length, { timeout: 30_000 })
    .toBe(1);
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByText("Unusual transaction", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+&txn=\d+$/);

  // It's fine: the flag is put away.
  await page.goto("/review");
  const fine = box(page).getByRole("button", {
    name: /^Power company, .*180.*: it's fine$/,
  });
  await fine.click();
  await expect(fine).toHaveCount(0);
});
