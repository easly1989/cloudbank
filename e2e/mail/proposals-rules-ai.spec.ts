import { expect, test, type Page } from "@playwright/test";

// The AI's rule proposal (#705) on the real server, explained by the pretend
// AI provider in ../server/cmd/e2e-mail: turned on, the proposal comes at once
// on Rules; "Create rule" opens a new rule filled in, whose preview shows the
// transactions it would touch, and nothing is saved until the user saves it,
// which closes the row and offers to fill in the ones without a category.
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
    hasText: /rules? to add/,
  });

test("a payee always filed alike: Create rule fills the rule, Save closes the row", async ({
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
  const payee = await post<{ id: number }>("/payees", {
    name: "Corner bakery",
  });
  const bread = await post<{ id: number }>("/categories", { name: "Bread" });
  const day = (monthsBack: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 8))
      .toISOString()
      .slice(0, 10);
  // Filed under Bread by hand three times, once not at all.
  for (const [back, categoryId] of [
    [4, bread.id],
    [3, bread.id],
    [2, bread.id],
    [1, null],
  ] as const) {
    await post("/transactions", {
      accountId: checking.id,
      date: day(back),
      amount: -1250,
      payeeId: payee.id,
      categoryId,
      memo: "sourdough",
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
        subscriptions: false,
        savings: false,
        goals: false,
        unusual: false,
        rules: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  await expect(async () => {
    await page.goto("/assignments");
    await expect(box(page)).toContainText(
      "These payees always get the same category",
      { timeout: 2_000 },
    );
  }).toPass({ timeout: 30_000 });
  await expect(box(page)).toContainText(
    "Bread in 3 of 4 transactions · 1 without a category",
  );

  // The model got the payee, its category and the counts: no amount, no memo.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(
    "Corner bakery: Bread in 3 of 4 transactions, 1 without a category",
  );
  expect(sent).not.toContain("12.50");
  expect(sent).not.toContain("sourdough");

  type Row = { payeeId: number };
  const rows = async () =>
    (
      (await (
        await page.request.get(`${base}/insights/proposals`, { headers: H })
      ).json()) as { proposals: { kind: string; basis: { rows: Row[] } }[] }
    ).proposals
      .filter((p) => p.kind === "rules")
      .flatMap((p) => p.basis.rows);
  expect((await rows()).map((r) => r.payeeId)).toContain(payee.id);

  // Create rule: the payee exactly, Bread, and the preview of what it touches.
  await box(page)
    .getByRole("button", {
      name: "Create a rule: payee is Corner bakery, category Bread",
    })
    .click();
  const sheet = page.getByTestId("rule-sheet");
  await expect(sheet.getByRole("heading", { name: "New rule" })).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Text" })).toHaveValue(
    "Corner bakery",
  );
  await expect(sheet.getByRole("combobox", { name: "Match" })).toHaveValue(
    "is exactly",
  );
  await expect(sheet.getByRole("combobox", { name: "Category" })).toHaveValue(
    "Bread",
  );
  await expect(sheet).toContainText("Matches 4 transactions");
  expect(
    (
      (await (
        await page.request.get(`${base}/assignments`, { headers: H })
      ).json()) as { pattern: string }[]
    ).some((r) => r.pattern === "Corner bakery"),
  ).toBe(false);

  // Save: the row is done, and the one without a category can be filled in.
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  const confirm = page.getByRole("dialog", {
    name: "Apply this rule to its 4 transactions?",
  });
  await confirm.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect
    .poll(async () => (await rows()).map((r) => r.payeeId))
    .not.toContain(payee.id);
  const register = (await (
    await page.request.get(
      `${base}/transactions?accountId=${checking.id}&limit=500`,
      { headers: H },
    )
  ).json()) as { transactions: { payeeId?: number; categoryId?: number }[] };
  const bakery = register.transactions.filter((t) => t.payeeId === payee.id);
  expect(bakery).toHaveLength(4);
  expect(bakery.every((t) => t.categoryId === bread.id)).toBe(true);
});
