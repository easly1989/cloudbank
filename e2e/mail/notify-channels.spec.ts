import { expect, test, type Page } from "@playwright/test";

// The email and webhook channels (#686), against the pretend SMTP server and
// webhook receiver in ../server/cmd/e2e-mail; an address is confirmed with the
// code mailed to it (#716). It runs after the other mail
// specs, on the server they set up; the administrator may send to this
// machine, which is how the webhook reaches the receiver at all.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
const ADDRESS = "avvisi.demo@example.org";

type Received = {
  to?: string;
  subject?: string;
  hook?: string;
  payload?: { event: string; test: boolean };
  signature?: string;
};

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

async function received(page: Page) {
  const res = await page.request.get(`${FAKE}/notify/received`);
  return (await res.json()) as { mails: Received[]; hooks: Received[] };
}

// The channel's page opens with its connection card.
const card = (page: Page) => page.locator(".mantine-Card-root").first();

// Types a confirmation code into the six boxes and confirms it (#716).
async function typeCode(page: Page, code: string) {
  await page.locator(".mantine-PinInput-input").first().click();
  await page.keyboard.type(code);
  await page.getByRole("button", { name: "Confirm" }).click();
}

test("an email channel sends its test through the mail server", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications");
  // The overview lists the channel and opens its page.
  await page.getByRole("link", { name: /^Email/ }).click();
  await expect(page).toHaveURL(/\/settings\/notifications\/email$/);
  const email = card(page);
  await email.getByLabel("Address").fill(ADDRESS);
  await email.getByRole("button", { name: "Save" }).click();
  await expect(email.getByText(`We sent a code to ${ADDRESS}`)).toBeVisible();
  await expect(email.getByRole("button", { name: "Send a test" })).toHaveCount(
    0,
  );
  const mail = (await received(page)).mails.findLast((m) => m.to === ADDRESS);
  const code = /\b\d{6}\b/.exec(mail?.subject ?? "")?.[0] ?? "";
  expect(code).toMatch(/^\d{6}$/);
  await typeCode(page, code === "000000" ? "111111" : "000000");
  await expect(page.getByText("That is not the code.")).toBeVisible();
  await typeCode(page, code);
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await email.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  await expect(email.getByText(/^Last delivered: /)).toBeVisible();
  // Connected, the channel's events can be chosen.
  await expect(page.getByRole("checkbox", { name: "Bills due" })).toBeEnabled();

  const { mails } = await received(page);
  expect(mails.some((m) => m.to === ADDRESS)).toBe(true);
});

test("a webhook test is signed, and a refusal stays on the page", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications/webhook");
  await expect(
    page.getByRole("checkbox", { name: "Bills due" }),
  ).toBeDisabled();
  const hook = card(page);
  await hook.getByLabel("URL").fill(`${FAKE}/hook/home`);
  await hook.getByLabel("Signing secret").fill("e2e-signing-secret");
  await hook.getByRole("button", { name: "Save" }).click();
  await hook.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();

  const { hooks } = await received(page);
  const got = hooks.find((h) => h.hook === "home");
  expect(got?.payload?.test).toBe(true);
  expect(got?.signature).toMatch(/^sha256=[0-9a-f]{64}$/);

  // The API names the host only, never the path or the secret.
  const state = await (
    await page.request.get("/api/v1/notifications/channels")
  ).text();
  expect(state).not.toContain("/hook/home");
  expect(state).not.toContain("e2e-signing-secret");

  await hook.getByLabel("URL").fill(`${FAKE}/hook/unauthorized`);
  await hook.getByRole("button", { name: "Save" }).click();
  await hook.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 401")).toBeVisible();
  await page.reload();
  await expect(card(page).getByText("Last delivery failed: 401")).toBeVisible();
});
