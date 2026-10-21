import { expect, test } from "@playwright/test";

// Review's bulk categorisation (#706) on the real server, the category asked of
// the pretend AI provider in ../server/cmd/e2e-mail: "Propose categories" finds
// the payee in the bank's text, takes the category from the payee's history or
// else from the model, which sees only the payee, the amount and the date; and
// nothing is saved until Confirm, which files only the rows still ticked.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

test("Propose categories fills payee and category in; Confirm files the ticked rows", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/v1/auth/login", { headers: H, data: USER })
    ).ok(),
  ).toBe(true);
  const [wallet] = (await (
    await page.request.get("/api/v1/wallets", { headers: H })
  ).json()) as { id: number }[];
  const base = `/api/v1/wallets/${wallet.id}`;
  const get = async <T>(path: string) =>
    (await (await page.request.get(base + path, { headers: H })).json()) as T;
  const post = async <T>(path: string, data: object) => {
    const res = await page.request.post(base + path, { headers: H, data });
    expect(res.ok()).toBe(true);
    return (await res.json()) as T;
  };
  const checking = (
    await get<{ id: number; name: string }[]>("/accounts")
  ).find((a) => a.name === "Checking")!;
  // A word of its own, so a rerun meets none of the last run's rows.
  const s = Date.now().toString(36);
  const tea = await post<{ id: number }>("/payees", { name: `Tea house ${s}` });
  const gym = await post<{ id: number }>("/payees", {
    name: `Climbing gym ${s}`,
  });
  const drinks = await post<{ id: number }>("/categories", {
    name: `Drinks ${s}`,
  });
  type Category = { id: number; name: string };
  let sport = (await get<Category[]>("/categories")).find(
    (c) => c.name === "Sport",
  );
  sport ??= await post<Category>("/categories", { name: "Sport" });

  // The tea house's history: always Drinks.
  for (const date of ["2026-05-03", "2026-06-03", "2026-07-03"]) {
    await post("/transactions", {
      accountId: checking.id,
      date,
      amount: -450,
      payeeId: tea.id,
      categoryId: drinks.id,
    });
  }
  const memos = {
    tea: `POS PAYMENT TEA HOUSE ${s.toUpperCase()} MILANO`,
    gym: `CARD PAYMENT CLIMBING GYM ${s.toUpperCase()}`,
    atm: `ATM WITHDRAWAL ${s.toUpperCase()}`,
  };
  await post("/import/commit", {
    accountId: checking.id,
    rows: Object.entries(memos).map(([k, memo], i) => ({
      date: `2026-10-1${i}`,
      amount: -1890 - i,
      memo,
      paymentMode: 6,
      importRef: `e2e-706:${s}:${k}`,
    })),
  });

  const res = await page.request.put("/api/v1/ai/settings", {
    headers: H,
    data: {
      enabled: true,
      baseUrl: `${FAKE}/v1`,
      model: "pretend",
      features: {
        suggest: true,
        entry: false,
        mail: true,
        reports: false,
        budgets: false,
        subscriptions: false,
        savings: false,
        goals: false,
        unusual: false,
        rules: false,
      },
    },
  });
  expect(res.ok()).toBe(true);

  await page.goto("/review");
  const card = page.locator('[data-tour="review-categories"]');
  const row = (k: keyof typeof memos) =>
    card.getByTestId("needs-category-row").filter({ hasText: memos[k] });
  await expect(row("tea")).toBeVisible();
  await expect(card).toContainText(
    "with the payee, the amount and the date only",
  );
  await card.getByRole("button", { name: "Propose categories" }).click();

  // The tea house from its history, the gym from the model, the cash nothing.
  await expect(row("tea").getByRole("combobox", { name: "Payee" })).toHaveValue(
    `Tea house ${s}`,
  );
  await expect(
    row("tea").getByRole("combobox", { name: "Category" }),
  ).toHaveValue(`Drinks ${s}`);
  await expect(row("tea")).toContainText("From history");
  await expect(row("gym").getByRole("combobox", { name: "Payee" })).toHaveValue(
    `Climbing gym ${s}`,
  );
  await expect(
    row("gym").getByRole("combobox", { name: "Category" }),
  ).toHaveValue(/Sport$/);
  await expect(row("gym")).toContainText("AI");
  await expect(row("atm")).toContainText("No payee recognised");
  await expect(row("atm").getByRole("checkbox")).toHaveCount(0);

  // The model saw the gym's payee, amount and date: never the bank's text.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(
    `Payee: Climbing gym ${s}; Amount: -18.91 EUR; Date: 2026-10-11`,
  );
  for (const word of ["CLIMBING", "TEA HOUSE", "ATM", "Tea house"]) {
    expect(sent).not.toContain(word);
  }

  // Nothing saved yet.
  type Txn = { memo: string; payeeId?: number; categoryId?: number };
  const mine = async () =>
    (
      await get<{ transactions: Txn[] }>(
        `/transactions?accountId=${checking.id}&limit=500`,
      )
    ).transactions.filter((t) => t.memo.includes(s.toUpperCase()));
  expect((await mine()).every((t) => !t.categoryId)).toBe(true);

  // Only these two rows: other tests' rows stay as they are.
  await card.getByRole("checkbox", { name: /^Select all/ }).click();
  await card.getByRole("checkbox", { name: `Include: ${memos.tea}` }).check();
  await card.getByRole("checkbox", { name: `Include: ${memos.gym}` }).check();
  await card.getByRole("button", { name: "Confirm 2" }).click();
  await expect(row("tea")).toHaveCount(0);
  await expect(row("gym")).toHaveCount(0);
  await expect(row("atm")).toBeVisible();

  const after = await mine();
  const by = (memo: string) => after.find((t) => t.memo === memo)!;
  expect(by(memos.tea)).toMatchObject({
    payeeId: tea.id,
    categoryId: drinks.id,
  });
  expect(by(memos.gym)).toMatchObject({
    payeeId: gym.id,
    categoryId: sport.id,
  });
  expect(by(memos.atm).categoryId).toBeFalsy();
});
