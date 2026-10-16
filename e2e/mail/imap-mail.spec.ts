import { expect, test, type Page } from "@playwright/test";

// A mailbox connected over IMAP with an app password (#658), against the
// pretend provider in ../server/cmd/e2e-mail, which CloudBank is allowed to
// reach on this machine (CB_MAIL_LOCAL_IMAP). It runs after bank-mail.spec.ts,
// on the server that spec set up. Every mail is invented.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
// The pretend provider's mailbox; its password is a test value of that server.
const GUEST = {
  address: "avvisi.demo@example.net",
  password: "e2e-app-password",
};
const SERVER = { host: "127.0.0.1", port: "1144" };

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

const cards = (page: Page) => page.getByTestId("mailbox-card");
const guestCard = (page: Page) =>
  cards(page).filter({ hasText: GUEST.address });

/** Opens the connect form and fills it for the pretend provider. */
async function fillForm(page: Page, password: string, host = SERVER.host) {
  await page.getByRole("button", { name: "Connect with IMAP" }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Email address").fill(GUEST.address);
  await form.getByLabel("Provider", { exact: true }).first().click();
  await page
    .getByRole("option", { name: "Another server", exact: true })
    .click();
  await form.getByLabel("App password").fill(password);
  await form.getByLabel("IMAP server").fill(host);
  await form.getByLabel("Port").fill(SERVER.port);
  return form;
}

test("a wrong password or a server off the internet saves nothing", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  // bank-mail.spec.ts left its Outlook mailbox.
  await expect(cards(page)).toHaveCount(1);

  let form = await fillForm(page, "wrong-password");
  await form.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(form.getByTestId("imap-error")).toContainText(
    "The mail server refused the sign-in.",
  );

  // The server checks where it would connect, not the form.
  await form.getByLabel("IMAP server").fill("10.0.0.1");
  await form.getByLabel("App password").fill(GUEST.password);
  await form.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(form.getByTestId("imap-error")).toContainText(
    "That server is not on the internet",
  );
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(cards(page)).toHaveCount(1);

  // An Outlook.com address is sent to Microsoft's sign-in instead.
  form = page.getByRole("dialog");
  await page.getByRole("button", { name: "Connect with IMAP" }).click();
  await form.getByLabel("Email address").fill("nome@outlook.com");
  await expect(
    form.getByRole("button", { name: "Sign in with Microsoft" }),
  ).toBeVisible();
  await expect(form.getByLabel("App password")).toHaveCount(0);
});

test("the right app password connects the mailbox, which never gives it back", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  const form = await fillForm(page, GUEST.password);
  await form.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByText(`Mailbox connected: ${GUEST.address}`),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    guestCard(page).getByText("IMAP", { exact: true }),
  ).toBeVisible();

  const wallets = await (await page.request.get("/api/v1/wallets")).json();
  const overview = await (
    await page.request.get(`/api/v1/wallets/${wallets[0].id}/mail`)
  ).text();
  expect(overview).toContain(GUEST.address);
  expect(overview).not.toContain(GUEST.password);
});

test("the mailbox reads what arrives", async ({ page }) => {
  await signIn(page);
  const res = await page.request.post(`${FAKE}/deliver`, {
    data: {
      mailbox: "imap",
      folder: "INBOX",
      from: "avvisi@banca.example",
      subject: "Addebito carta",
      body: "Addebito di 12,30 EUR presso Edicola Demo.\nBanca Demo",
      authenticated: true,
    },
  });
  expect(res.status()).toBe(204);
  await page.goto("/settings/mail");
  await guestCard(page).getByRole("button", { name: "Check now" }).click();
  await expect(guestCard(page).getByText("Addebito carta")).toBeVisible();
  await expect(
    guestCard(page).getByText("Not recognised", { exact: true }),
  ).toHaveCount(1);
});

test("a new app password is checked before it replaces the old one", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/mail");
  await guestCard(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "New app password" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Email address")).toBeDisabled();
  await expect(form.getByLabel("IMAP server")).toHaveValue(SERVER.host);

  await form.getByLabel("App password").fill("wrong-password");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByTestId("imap-error")).toContainText(
    "The mail server refused the sign-in.",
  );
  await form.getByLabel("App password").fill(GUEST.password);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText(`New password saved for ${GUEST.address}`),
  ).toBeVisible();
  await expect(guestCard(page)).toHaveCount(1);
});
