import { expect, test } from "@playwright/test";

// Ask your data (#704) on the real server, asked of the pretend AI provider in
// ../server/cmd/e2e-mail: the first call picks the total of the category the
// question names, CloudBank computes it, the second call reads it back. The
// answer shows the numbers used; the model hears names and results, never a
// memo. A question no query fits says so, and the earlier one stays a click
// away while the page is open.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

test("a question about the wallet is answered from CloudBank's numbers", async ({
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
  const post = async <T>(path: string, data: object) => {
    const res = await page.request.post(base + path, { headers: H, data });
    expect(res.ok()).toBe(true);
    return (await res.json()) as T;
  };
  const checking = (
    (await (
      await page.request.get(base + "/accounts", { headers: H })
    ).json()) as { id: number; name: string }[]
  ).find((a) => a.name === "Checking")!;
  // A category of its own, so a rerun counts only its own transactions.
  const name = `Dining ${Date.now().toString(36)}`;
  const cat = await post<{ id: number }>("/categories", { name });
  for (const amount of [-1250, -2000]) {
    await post("/transactions", {
      accountId: checking.id,
      date: "2026-07-14",
      amount,
      categoryId: cat.id,
      memo: "a private note",
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
        rules: false,
        payees: false,
        import: false,
        ask: true,
      },
    },
  });
  expect(res.ok()).toBe(true);
  const used = async () =>
    (
      (await (
        await page.request.get("/api/v1/ai/settings", { headers: H })
      ).json()) as { used: number }
    ).used;
  const before = await used();

  // Reports off, questions on: AI insights is in the sidebar all the same.
  await page.goto("/");
  await page.getByRole("link", { name: "AI insights" }).first().click();
  const field = page.getByRole("textbox", { name: "Ask your data" });
  const question = `How much did I spend on ${name.toLowerCase()}?`;
  await field.fill(question);
  await page.getByRole("button", { name: "Ask", exact: true }).click();

  const box = page.getByRole("region", { name: "AI answer" });
  await expect(box).toContainText(question);
  await expect(box).toContainText(/That comes to 32\.50 [A-Z]{3}\./);
  await expect(box).toContainText("Numbers used, computed by CloudBank");
  await expect(box).toContainText(name);
  await expect(box).toContainText("2 transactions");
  expect(await used()).toBe(before + 2);

  // The second call heard the result, never the memo.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain("over 2 transactions");
  expect(sent).not.toContain("private note");

  // No query fits: one call, and the box says so.
  await field.fill("What is the weather like?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(box).toContainText(
    "None of CloudBank's queries could answer this",
  );
  expect(await used()).toBe(before + 3);

  // The earlier question is still there.
  await page.getByRole("button", { name: question }).click();
  await expect(box).toContainText(/That comes to 32\.50 [A-Z]{3}\./);
});
