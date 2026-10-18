import { expect, test, type Page } from "@playwright/test";

// The Matrix channel (#687), against the pretend homeserver in
// ../server/cmd/e2e-mail. The installation has a shared bot
// (CB_MATRIX_HOMESERVER, CB_MATRIX_TOKEN); a person may still post as a bot of
// their own, saved through the API here since the page offers the shared one.
// It runs after the other mail specs, on the server they set up.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
const ROOM = "!famiglia:matrix.example";
// The pretend homeserver's token for a person's own bot: a test value.
const OWN_TOKEN = "e2e-matrix-user";

type Message = { room: string; sender: string; body: string };

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

async function messages(page: Page) {
  const res = await page.request.get(`${FAKE}/notify/received`);
  return ((await res.json()) as { matrix: Message[] }).matrix;
}

const card = (page: Page) =>
  page.locator(".mantine-Card-root").filter({
    has: page.getByRole("heading", { name: "Matrix", exact: true }),
  });

test("with the shared bot, the room is all it takes", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/notifications");
  const matrix = card(page);
  await expect(
    matrix.getByText("Invite @cloudbank:matrix.example to the room"),
  ).toBeVisible();
  await expect(matrix.getByLabel("Bot's access token")).toHaveCount(0);
  await matrix.getByLabel("Room ID").fill(ROOM);
  await matrix.getByRole("button", { name: "Save" }).click();
  // The bot was only invited: it joins the room, then posts.
  await matrix.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Matrix" }),
  ).toBeVisible();

  const got = await messages(page);
  expect(got.at(-1)).toMatchObject({
    room: ROOM,
    sender: "@cloudbank:matrix.example",
  });
});

test("a bot of one's own posts with its token, which never comes back", async ({
  page,
}) => {
  await signIn(page);
  const res = await page.request.put("/api/v1/notifications/channels/matrix", {
    headers: H,
    data: { target: ROOM, server: FAKE, secret: OWN_TOKEN },
  });
  expect(res.status()).toBe(204);
  const state = await (
    await page.request.get("/api/v1/notifications/channels")
  ).text();
  expect(state).not.toContain(OWN_TOKEN);

  await page.goto("/settings/notifications");
  const matrix = card(page);
  await expect(matrix.getByLabel("Homeserver")).toHaveValue(FAKE);
  await matrix.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await messages(page)).at(-1)?.sender).toBe(
    "@demo-bot:matrix.example",
  );
});

test("a refused token shows its 401 on the page", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/notifications");
  const matrix = card(page);
  await matrix.getByLabel("Bot's access token").fill("not-a-token");
  await matrix.getByRole("button", { name: "Save" }).click();
  await matrix.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 401")).toBeVisible();
  await page.reload();
  await expect(card(page).getByText("Last delivery failed: 401")).toBeVisible();
});
