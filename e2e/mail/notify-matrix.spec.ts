import { expect, test, type Page } from "@playwright/test";

// The Matrix channel (#687), against the pretend homeserver in
// ../server/cmd/e2e-mail. The installation has a shared bot
// (CB_MATRIX_HOMESERVER, CB_MATRIX_TOKEN), which joins only a room it was
// invited to and proves the room with a code (#716); a person may still post
// as a bot of their own, saved through the API here since the page offers the
// shared one.
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

// The channel's page opens with its connection card.
const card = (page: Page) => page.locator(".mantine-Card-root").first();

// Types a confirmation code into the six boxes and confirms it (#716).
async function typeCode(page: Page, code: string) {
  await page.locator(".mantine-PinInput-input").first().click();
  await page.keyboard.type(code);
  await page.getByRole("button", { name: "Confirm" }).click();
}

test("the shared bot joins only a room it was invited to, and its code connects it", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications/matrix");
  const matrix = card(page);
  await expect(
    matrix.getByText("Invite @cloudbank:matrix.example to the room."),
  ).toBeVisible();
  await expect(matrix.getByLabel("Bot's access token")).toHaveCount(0);
  await matrix.getByLabel("Room ID").fill(ROOM);
  await matrix.getByRole("button", { name: "Connect" }).click();
  await expect(
    page.getByText("The bot has no invitation to that room."),
  ).toBeVisible();
  const before = (await messages(page)).length;

  // Invited, as one would in a Matrix app: the bot joins and writes a code.
  await page.request.post(`${FAKE}/notify/matrix/invite`, {
    data: { room: ROOM },
  });
  await matrix.getByRole("button", { name: "Connect" }).click();
  await expect(
    matrix.getByText("The bot joined and wrote a code in the room"),
  ).toBeVisible();
  const got = await messages(page);
  expect(got).toHaveLength(before + 1);
  expect(got.at(-1)).toMatchObject({
    room: ROOM,
    sender: "@cloudbank:matrix.example",
  });
  await expect(
    page.getByRole("checkbox", { name: "Bills due" }),
  ).toBeDisabled();
  await typeCode(page, /\b\d{6}\b/.exec(got.at(-1)?.body ?? "")?.[0] ?? "");
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(matrix.getByText(`Connected: ${ROOM}`)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Bills due" })).toBeEnabled();
  await matrix.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
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

  await page.goto("/settings/notifications/matrix");
  const matrix = card(page);
  // A bot of one's own shows as such, with its homeserver.
  await expect(matrix.getByRole("radio", { name: "Your bot" })).toBeChecked();
  await expect(matrix.getByLabel("Homeserver")).toHaveValue(FAKE);
  await matrix.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await messages(page)).at(-1)?.sender).toBe(
    "@demo-bot:matrix.example",
  );
});

test("a refused token shows its 401 on the page", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/notifications/matrix");
  const matrix = card(page);
  await matrix.getByLabel("Bot's access token").fill("not-a-token");
  await matrix.getByRole("button", { name: "Save" }).click();
  await matrix.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 401")).toBeVisible();
  await page.reload();
  await expect(card(page).getByText("Last delivery failed: 401")).toBeVisible();
});
