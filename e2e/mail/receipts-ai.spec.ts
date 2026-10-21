import { expect, test, type Page } from "@playwright/test";

// Receipts (#707) on the real server and the pretend AI provider in
// ../server/cmd/e2e-mail, which reads any photo that decodes as the same
// receipt. The photo is an invented one, drawn by the test. Nothing goes to
// the model before "Read with AI"; the fields fill and nothing is saved before
// Save; the log keeps a line about the photo, never the photo; the photo is
// attached only when asked.
// It runs after mail-ai.spec.ts, which pointed the AI at the pretend provider.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

/** An invented receipt, drawn on a canvas: never a real one. */
async function drawReceipt(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 420;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 300, 420);
    g.fillStyle = "#222";
    g.font = "bold 18px monospace";
    g.fillText("CORNER BAKERY", 70, 50);
    g.font = "14px monospace";
    g.fillText("TOTAL EUR      12,50", 50, 200);
    g.fillText("20/10/2026", 50, 240);
    return c.toDataURL("image/png");
  });
  return Buffer.from(url.split(",")[1], "base64");
}

test("a receipt's photo fills the sheet, and is attached only when asked", async ({
  page,
}) => {
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
      features: { ...st.features, receipts: true },
    },
  });
  expect(res.ok()).toBe(true);
  const [wallet] = (await (
    await page.request.get("/api/v1/wallets", { headers: H })
  ).json()) as { id: number }[];
  const base = `/api/v1/wallets/${wallet.id}`;
  const checking = (
    (await (
      await page.request.get(`${base}/accounts`, { headers: H })
    ).json()) as { id: number; name: string }[]
  ).find((a) => a.name === "Checking")!;
  type Txn = { id: number; memo: string };
  const bakery = async () =>
    (
      (await (
        await page.request.get(
          `${base}/transactions?accountId=${checking.id}&limit=500`,
          { headers: H },
        )
      ).json()) as { transactions: Txn[] }
    ).transactions.filter((t) => t.memo === "Bread and pastries");
  const used = async () =>
    (
      (await (
        await page.request.get("/api/v1/ai/settings", { headers: H })
      ).json()) as { used: number }
    ).used;
  await page.goto("/");
  const receipt = await drawReceipt(page);

  for (const attach of [false, true]) {
    const before = (await bakery()).map((t) => t.id);
    const calls = await used();
    await page.goto(`/transactions?accountId=${checking.id}&new=1`);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Scan a receipt")).toBeVisible();
    await sheet.locator('input[type="file"]').setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: receipt,
    });
    await expect(
      sheet.getByRole("img", { name: "Receipt photo" }),
    ).toBeVisible();
    await expect(sheet).toContainText(
      "The photo is not kept unless you attach it.",
    );
    // Picked, not sent.
    expect(await used()).toBe(calls);

    await sheet.getByRole("button", { name: "Read with AI" }).click();
    await expect(sheet).toContainText(
      "Read by the AI: check the fields and save.",
    );
    await expect(
      sheet.getByRole("textbox", { name: "Amount", exact: true }),
    ).toHaveValue(/^12[.,]50$/);
    await expect(
      sheet.getByRole("textbox", { name: "Memo", exact: true }),
    ).toHaveValue("Bread and pastries");
    expect(await used()).toBe(calls + 1);
    // The browser shrank it to a JPEG, which reached the model.
    const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
    expect(sent).toContain("The receipt is in the photo.");
    expect(sent).toContain("[photo jpeg 300x420]");
    // The log has a line about the photo, never the photo.
    const { sends } = (await (
      await page.request.get("/api/v1/ai/sends?limit=1", { headers: H })
    ).json()) as { sends: { id: number; feature: string }[] };
    expect(sends[0].feature).toBe("receipts");
    const one = (await (
      await page.request.get(`/api/v1/ai/sends/${sends[0].id}`, { headers: H })
    ).json()) as { sent: string };
    expect(one.sent).toMatch(/\[photo JPEG 300×420, \d+ KB, not kept\]$/);
    expect(one.sent).not.toContain("base64");
    // Nothing saved yet.
    expect((await bakery()).length).toBe(before.length);

    const box = sheet.getByRole("checkbox", {
      name: "Attach the photo to the transaction",
    });
    await expect(box).not.toBeChecked();
    if (attach) await box.check();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet).toBeHidden();
    const added = (await bakery()).filter((t) => !before.includes(t.id));
    expect(added.length).toBe(1);
    const files = (await (
      await page.request.get(
        `${base}/attachments?transactionId=${added[0].id}`,
        {
          headers: H,
        },
      )
    ).json()) as { filename: string; contentType: string }[];
    expect(files.length).toBe(attach ? 1 : 0);
    if (attach) expect(files[0].contentType).toBe("image/jpeg");
  }
});
