import { expect, test, type Page } from "@playwright/test";

// ntfy and Gotify (#689), against the pretend servers in
// ../server/cmd/e2e-mail. Both sit on this machine, which only an
// administrator may save, as here. It runs after the other mail specs, on the
// server they set up.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
// The pretend Gotify server's application token: a test value.
const GOTIFY_TOKEN = "e2e-gotify-app";

type Chat = { hook: string; body: string };

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

async function chats(page: Page) {
  const res = await page.request.get(`${FAKE}/notify/received`);
  return ((await res.json()) as { chats: Chat[] }).chats;
}

// The channel's page opens with its connection card.
const card = (page: Page) => page.locator(".mantine-Card-root").first();

test("ntfy publishes to the topic, and a refused token shows its 401", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications/ntfy");
  const ntfy = card(page);
  await ntfy.getByLabel("Server").fill(`${FAKE}/ntfy`);
  await ntfy.getByLabel("Topic").fill("cloudbank-famiglia-e2e");
  await ntfy.getByRole("button", { name: "Save" }).click();
  await ntfy.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await chats(page)).at(-1)?.hook).toBe("ntfy/cloudbank-famiglia-e2e");

  await ntfy.getByLabel("Access token").fill("tk_refused-token");
  await ntfy.getByRole("button", { name: "Save" }).click();
  await ntfy.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 401")).toBeVisible();
  await page.reload();
  await expect(card(page).getByText("Last delivery failed: 401")).toBeVisible();
});

test("Gotify posts with the application token, which never comes back", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications/gotify");
  const gotify = card(page);
  await gotify.getByLabel("Server").fill(`${FAKE}/gotify`);
  await gotify.getByLabel("Application token").fill(GOTIFY_TOKEN);
  await gotify.getByRole("button", { name: "Save" }).click();
  await gotify.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await chats(page)).at(-1)?.hook).toBe("gotify");
  const state = await (
    await page.request.get("/api/v1/notifications/channels")
  ).text();
  expect(state).not.toContain(GOTIFY_TOKEN);

  await gotify.getByLabel("Application token").fill("refused");
  await gotify.getByRole("button", { name: "Save" }).click();
  await gotify.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 401")).toBeVisible();
});
