import { expect, test, type Page } from "@playwright/test";

// Telegram, Discord and Slack (#688), against the pretend services in
// ../server/cmd/e2e-mail. The installation has a shared Telegram bot
// (CB_TELEGRAM_TOKEN); a bot of one's own is saved through the API here, since
// the page offers the shared one. It runs after the other mail specs, on the
// server they set up.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };
// The pretend Bot API's token for a person's own bot: a test value.
const OWN_TOKEN = "222222:e2e-telegram-user-bot-token0";

type Chat = { hook: string; to?: string; sender?: string; body: string };

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

// The channel's page has one card with a Save button: its connection.
const card = (page: Page) =>
  page
    .locator(".mantine-Card-root")
    .filter({ has: page.getByRole("button", { name: "Save" }) });

async function channelState(page: Page) {
  return (await page.request.get("/api/v1/notifications/channels")).text();
}

test("Telegram: the shared bot needs only the chat; an unknown chat shows on the page", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications/telegram");
  const tg = card(page);
  await expect(
    tg.getByText("A message from @cloudbank_demo_bot. Send it /start"),
  ).toBeVisible();
  await expect(tg.getByLabel("Bot token")).toHaveCount(0);
  await tg.getByLabel("Chat ID").fill("424242");
  await tg.getByRole("button", { name: "Save" }).click();
  await tg.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await chats(page)).at(-1)).toMatchObject({
    hook: "telegram",
    to: "424242",
    sender: "shared",
  });

  await tg.getByLabel("Chat ID").fill("0");
  await tg.getByRole("button", { name: "Save" }).click();
  await tg.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 400")).toBeVisible();
  await page.reload();
  await expect(card(page).getByText("Last delivery failed: 400")).toBeVisible();

  // A topic and a silent send are kept with the chat.
  await card(page).getByLabel("Chat ID").fill("-100424242");
  await card(page).getByLabel("Topic ID").fill("7");
  await card(page).getByRole("switch", { name: "Send silently" }).check();
  await card(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  const { channels } = JSON.parse(await channelState(page)) as {
    channels: { channel: string; target: string; options: object }[];
  };
  expect(channels.find((c) => c.channel === "telegram")).toMatchObject({
    target: "-100424242",
    options: { topic: 7, silent: true },
  });
});

test("Telegram: a bot of one's own sends with its token, which never comes back", async ({
  page,
}) => {
  await signIn(page);
  const res = await page.request.put(
    "/api/v1/notifications/channels/telegram",
    { headers: H, data: { target: "424242", secret: OWN_TOKEN } },
  );
  expect(res.status()).toBe(204);
  expect(await channelState(page)).not.toContain(OWN_TOKEN);

  await page.goto("/settings/notifications/telegram");
  const tg = card(page);
  await tg.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await chats(page)).at(-1)?.sender).toBe("own");

  await tg.getByLabel("Bot token").fill("333333:refused-token-00000000000000");
  await tg.getByRole("button", { name: "Save" }).click();
  await tg.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("The test failed: 401")).toBeVisible();
});

for (const { title, refusal } of [
  { title: "Discord", refusal: "401" },
  { title: "Slack", refusal: "403" },
]) {
  test(`${title}: the webhook posts, its URL never comes back, a refusal shows`, async ({
    page,
  }) => {
    const service = title.toLowerCase();
    await signIn(page);
    await page.goto(`/settings/notifications/${service}`);
    const c = card(page);
    await c.getByLabel("URL").fill(`${FAKE}/${service}/family-key`);
    await c.getByRole("button", { name: "Save" }).click();
    await c.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText("Test sent")).toBeVisible();
    expect((await chats(page)).at(-1)?.hook).toBe(`${service}/family-key`);
    expect(await channelState(page)).not.toContain("family-key");
    await expect(
      page.getByRole("checkbox", { name: "Bills due" }),
    ).toBeEnabled();

    await c.getByLabel("URL").fill(`${FAKE}/${service}/unauthorized`);
    await c.getByRole("button", { name: "Save" }).click();
    await c.getByRole("button", { name: "Send a test" }).click();
    await expect(page.getByText(`The test failed: ${refusal}`)).toBeVisible();
    await page.reload();
    await expect(
      card(page).getByText(`Last delivery failed: ${refusal}`),
    ).toBeVisible();
  });
}
