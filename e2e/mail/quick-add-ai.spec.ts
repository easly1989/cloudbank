import { expect, test } from "@playwright/test";

// Quick add with the AI (#702), on the real server and the pretend AI provider
// in ../server/cmd/e2e-mail: text shared from a bank's notification is read at
// once, the fields fill in the account's own format, and nothing is saved
// until Save.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

test("shared text is read by the AI and waits for Save", async ({ page }) => {
  expect(
    (
      await page.request.post("/api/v1/auth/login", { headers: H, data: USER })
    ).ok(),
  ).toBe(true);
  const st = await (
    await page.request.get("/api/v1/ai/settings", { headers: H })
  ).json();
  const res = await page.request.put("/api/v1/ai/settings", {
    headers: H,
    data: {
      enabled: true,
      baseUrl: `${FAKE}/v1`,
      model: "pretend",
      features: { ...st.features, entry: true },
    },
  });
  expect(res.ok()).toBe(true);
  const [wallet] = (await (
    await page.request.get("/api/v1/wallets", { headers: H })
  ).json()) as {
    id: number;
  }[];
  const base = `/api/v1/wallets/${wallet.id}`;
  const accounts = (await (
    await page.request.get(`${base}/accounts`, { headers: H })
  ).json()) as {
    id: number;
  }[];
  // Every transaction of the wallet, account by account.
  const count = async () => {
    let n = 0;
    for (const a of accounts) {
      const r = await page.request.get(
        `${base}/transactions?accountId=${a.id}&limit=1`,
        {
          headers: H,
        },
      );
      n += ((await r.json()) as { total: number }).total;
    }
    return n;
  };
  const before = await count();

  const text =
    "Card payment of 12.5 EUR at Corner Bakery on 20/10. Not you? Call us.";
  await page.goto(`/transactions?text=${encodeURIComponent(text)}`);
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // The text sits in the AI's quick entry, already read.
  await expect(
    sheet.getByRole("textbox", { name: "Quick entry", exact: true }),
  ).toHaveValue(text);
  await expect(
    sheet.getByText("From the shared text: check the fields and save"),
  ).toBeVisible();
  await expect(
    sheet.getByRole("textbox", { name: "Amount", exact: true }),
  ).toHaveValue(/^12[.,]50$/);
  await expect(
    sheet.getByRole("textbox", { name: "Memo", exact: true }),
  ).toHaveValue("Card payment");
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain(`Description: ${text}`);
  // Nothing is saved until Save.
  expect(await count()).toBe(before);
});
