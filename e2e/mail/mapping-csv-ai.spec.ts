import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

// The CSV column mapping (#709) on the real server, asked of the pretend AI
// provider in ../server/cmd/e2e-mail: the map step of an unknown CSV comes
// filled in, the model having seen the column names and the shape of the rows
// only; the import remembers the mapping, and the next file with the same
// columns comes mapped without asking the AI again.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

async function open(page: Page, file: string) {
  await page.goto("/settings/data");
  await page.getByRole("tab", { name: "Bank / CSV / QIF / OFX" }).click();
  const panel = page.getByRole("tabpanel", { name: "Bank / CSV / QIF / OFX" });
  await panel.getByText("Generic CSV", { exact: true }).click();
  await panel.getByRole("combobox", { name: "Target account" }).click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();
  await panel.getByRole("textbox", { name: "Delimiter" }).fill(";");
  await panel.locator('input[type="file"]').setInputFiles({
    name: "statement.csv",
    mimeType: "text/plain",
    buffer: Buffer.from(file),
  });
  await panel.getByRole("button", { name: "Next" }).click();
  return panel;
}

test("an unknown CSV comes mapped by the AI, and the next one by memory", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/v1/auth/login", { headers: H, data: USER })
    ).ok(),
  ).toBe(true);
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
        import: true,
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

  // A column name of its own, so a rerun meets no mapping the last one kept.
  const s = Date.now().toString(36);
  // And a word in the rows the model must never see.
  const secret = `Q${randomUUID().slice(0, 6)}`;
  const file =
    `Booking date;Description;Counterparty;Amount;Balance ${s}\n` +
    `03/10/2026;CARD PAYMENT MILANO ${secret};Corner shop;-42,30;2457,70\n` +
    `04/10/2026;TRANSFER RECEIVED ${secret};Employer;1500,00;3957,70\n`;

  const before = await used();
  let panel = await open(page, file);
  const box = panel.getByRole("region", { name: "AI proposal" });
  await expect(box).toContainText("Date, Amount, Payee, and Memo matched");
  await expect(box).toContainText("Dates read as day-month-year.");
  await expect(box).toContainText("Amounts with a decimal comma.");
  const field = (column: string) =>
    panel.getByRole("combobox", { name: `Field for ${column}` });
  await expect(field("Booking date")).toHaveValue("Date");
  await expect(field("Counterparty")).toHaveValue("Payee");
  await expect(field(`Balance ${s}`)).toHaveValue("");
  expect(await used()).toBe(before + 1);

  // The model saw the names, the dates and the amounts; never the words.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain("2. Counterparty: text, 2 words | text, 1 word");
  expect(sent).toContain("0. Booking date: 03/10/2026 | 04/10/2026");
  for (const word of ["MILANO", "Corner shop", "Employer", secret]) {
    expect(sent).not.toContain(word);
  }

  await panel.getByRole("button", { name: "Preview" }).click();
  await expect(panel.getByRole("cell", { name: "2026-10-03" })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "Corner shop" })).toBeVisible();
  await panel.getByRole("button", { name: /^Import 2/ }).click();
  await expect(page.getByText("Created 2 transactions.")).toBeVisible();

  // The same columns: mapped from memory, no call to the AI.
  panel = await open(page, file);
  await expect(panel.getByTestId("csv-remembered")).toBeVisible();
  await expect(field("Booking date")).toHaveValue("Date");
  await expect(panel.getByRole("region", { name: "AI proposal" })).toHaveCount(
    0,
  );
  expect(await used()).toBe(before + 1);
});
