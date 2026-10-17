import { expect, test, type Page } from "@playwright/test";

// Bank mails read by the AI (#659), against the pretend AI provider in
// ../server/cmd/e2e-mail, which also tells what it was sent. It runs after
// imap-mail.spec.ts, on the app-password mailbox that spec connected. Every
// mail is invented, and so is the card number in it.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
const GUEST = "avvisi.demo@example.net";
const CARD = "4532 0151 1283 0366";

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

const card = (page: Page) =>
  page.getByTestId("mailbox-card").filter({ hasText: GUEST });

async function deliver(page: Page, authenticated: boolean, shop: string) {
  const res = await page.request.post(`${FAKE}/deliver`, {
    data: {
      mailbox: "imap",
      folder: "INBOX",
      from: "avvisi@banca.example",
      subject: "Pagamento con carta",
      body:
        `Ti informiamo che è stato richiesto un pagamento di 23,90 EUR con la carta ${CARD} ` +
        `presso ${shop}, alle 17:56.\nBanca Demo`,
      authenticated,
    },
  });
  expect(res.status()).toBe(204);
}

test("without AI set up, only the patterns can read the mails", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await expect(
    card(page).getByRole("link", { name: "Settings › AI" }),
  ).toBeVisible();
  await card(page)
    .getByLabel("How mails are read", { exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("option", { name: "The AI only" }),
  ).toHaveAttribute("data-combobox-disabled", "true");
  await page.keyboard.press("Escape");
});

test("with the AI after the patterns, a mail no pattern reads is written by it", async ({
  page,
}) => {
  await signIn(page);
  // An administrator may point the AI at a provider on this machine.
  const ai = await page.request.put("/api/v1/ai/settings", {
    headers: H,
    data: {
      enabled: true,
      baseUrl: `${FAKE}/v1`,
      model: "pretend",
      apiKey: "pretend-not-a-key",
    },
  });
  expect(ai.ok()).toBe(true);

  await page.goto("/settings/mail");
  await card(page)
    .getByLabel("How mails are read", { exact: true })
    .first()
    .click();
  await page
    .getByRole("option", { name: "Patterns first, then the AI", exact: true })
    .click();
  await expect(card(page).getByText(/goes to the AI provider/)).toBeVisible();
  await card(page).getByLabel("Account", { exact: true }).first().click();
  await page.getByRole("option", { name: "Checking", exact: true }).click();
  await card(page).getByLabel("The bank's senders").fill("banca.example");
  await card(page).getByLabel("The bank's senders").press("Enter");
  await card(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("How mails are read is saved.")).toBeVisible();

  await deliver(page, true, "Edicola Demo");
  await card(page).getByRole("button", { name: "Check now" }).click();
  await expect(
    card(page).getByRole("link", { name: /Edicola Demo/ }),
  ).toBeVisible();
  await expect(card(page).getByLabel("Read by the AI")).toHaveCount(1);

  // The card number never left: the provider got it hidden.
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).toContain("Edicola Demo");
  expect(sent).toContain("[hidden]");
  expect(sent).not.toContain("4532");
  expect(sent).not.toContain("0366");
});

test("a mail whose sender is not authenticated never reaches the AI", async ({
  page,
}) => {
  await signIn(page);
  await deliver(page, false, "Negozio Falso");
  await page.goto("/settings/mail");
  await card(page).getByRole("button", { name: "Check now" }).click();
  await expect(
    card(page).getByText("Not authenticated", { exact: true }),
  ).toHaveCount(1);
  await expect(
    card(page).getByRole("link", { name: /Negozio Falso/ }),
  ).toHaveCount(0);
  const sent = await (await page.request.get(`${FAKE}/ai/last`)).text();
  expect(sent).not.toContain("Negozio Falso");
});
