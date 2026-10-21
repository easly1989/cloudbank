import { expect, test } from "@playwright/test";

// The payee cleanup (#708) on the real server, the groups asked of the pretend
// AI provider in ../server/cmd/e2e-mail, which sees the payee names only: the
// preview merges two raw names into the payee that already has the clean one,
// with a rule for the next imports; nothing changes until Apply, and the bar
// below undoes it all.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

test("Clean up names merges raw names into the clean payee; Undo puts them back", async ({
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
  // A word of its own, so a rerun meets none of the last run's payees.
  const s = Date.now().toString(36);
  const S = s.toUpperCase();
  const raw1 = await post<{ id: number }>("/payees", {
    name: `KAFFEE ${S} *2K3`,
  });
  const raw2 = await post<{ id: number }>("/payees", {
    name: `KAFFEE ${S} *7H1`,
  });
  const clean = await post<{ id: number }>("/payees", { name: `Kaffee ${s}` });
  for (const payeeId of [raw1.id, raw1.id, raw2.id, clean.id]) {
    await post("/transactions", {
      accountId: checking.id,
      date: "2026-10-02",
      amount: -380,
      payeeId,
      memo: "espresso",
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
        payees: true,
      },
    },
  });
  expect(res.ok()).toBe(true);

  await page.goto("/payees");
  await page.getByRole("button", { name: "Clean up names" }).click();
  const box = page.getByRole("region", { name: "AI proposal" });
  await expect(box).toContainText("Payee names only");
  const mine = box
    .getByTestId("cleanup-group")
    .filter({ hasText: `KAFFEE ${S} *2K3` });
  await expect(mine).toContainText("Merges into the existing payee");
  await expect(mine).toContainText("3 transactions");
  await expect(mine.getByRole("textbox", { name: "Clean name" })).toHaveValue(
    `Kaffee ${s}`,
  );
  await expect(mine.getByRole("textbox", { name: "Rule text" })).toHaveValue(
    `KAFFEE ${S}`,
  );
  await expect(mine).toContainText("covers 2 of these names");

  // The model saw the names, never an amount or a memo.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(`KAFFEE ${S} *2K3`);
  expect(sent).not.toContain("3.80");
  expect(sent).not.toContain("espresso");

  // Nothing changed yet.
  type Payee = { id: number; name: string };
  const names = async () => (await get<Payee[]>("/payees")).map((p) => p.name);
  expect(await names()).toContain(`KAFFEE ${S} *2K3`);

  // Only this group: other tests' payees stay as they are.
  const others = box
    .getByTestId("cleanup-group")
    .filter({ hasNotText: `KAFFEE ${S} *2K3` });
  for (let i = (await others.count()) - 1; i >= 0; i--) {
    await others
      .nth(i)
      .getByRole("checkbox", { name: /^Include / })
      .uncheck();
  }
  await box.getByRole("button", { name: "Apply 1" }).click();
  await expect(box).toBeHidden();
  const bar = page.getByTestId("cleanup-bar");
  await expect(bar).toContainText("1 payee, 2 names, 1 rule.");

  type Txn = { payeeId?: number; memo: string };
  const onPayee = async (id: number) =>
    (
      await get<{ transactions: Txn[] }>(
        `/transactions?accountId=${checking.id}&limit=500`,
      )
    ).transactions.filter((t) => t.payeeId === id).length;
  expect(await names()).not.toContain(`KAFFEE ${S} *2K3`);
  expect(await onPayee(clean.id)).toBe(4);
  const rules = async () =>
    (await get<{ pattern: string }[]>("/assignments")).map((r) => r.pattern);
  expect(await rules()).toContain(`KAFFEE ${S}`);

  // Undo: the raw names, their transactions and no rule.
  await bar.getByRole("button", { name: "Undo last cleanup" }).click();
  await expect(bar).toBeHidden();
  expect(await names()).toContain(`KAFFEE ${S} *2K3`);
  expect(await onPayee(raw1.id)).toBe(2);
  expect(await onPayee(raw2.id)).toBe(1);
  expect(await onPayee(clean.id)).toBe(1);
  expect(await rules()).not.toContain(`KAFFEE ${S}`);
});
