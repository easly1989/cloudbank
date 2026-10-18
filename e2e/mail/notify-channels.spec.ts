import { expect, test, type Page } from "@playwright/test";

// The email and webhook channels (#686), against the pretend SMTP server and
// webhook receiver in ../server/cmd/e2e-mail. It runs after the other mail
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

const card = (page: Page, title: string) =>
  page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test("an email channel sends its test through the mail server", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications");
  const email = card(page, "Email");
  await email.getByLabel("Address").fill(ADDRESS);
  await email.getByRole("button", { name: "Save" }).click();
  await email.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  await expect(email.getByText(/^Last delivered: /)).toBeVisible();
  // The channel joins the events table.
  await expect(page.getByRole("columnheader", { name: "Email" })).toBeVisible();

  const { mails } = await received(page);
  expect(mails.some((m) => m.to === ADDRESS)).toBe(true);
});

test("a webhook test is signed, and a refusal stays on the page", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications");
  const hook = card(page, "Webhook");
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
  await expect(
    card(page, "Webhook").getByText("Last delivery failed: 401"),
  ).toBeVisible();
});
