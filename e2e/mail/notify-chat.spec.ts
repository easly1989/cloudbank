import { expect, test, type Page } from "@playwright/test";

// Telegram, Discord and Slack (#688), against the pretend services in
// ../server/cmd/e2e-mail. The installation has a shared Telegram bot
// (CB_TELEGRAM_TOKEN), which learns the chat from the link it is started with
// (#716); a bot of one's own is saved through the API here, since the page
// offers the shared one. It runs after the other mail specs, on the
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

// The channel's page opens with its connection card.
const card = (page: Page) => page.locator(".mantine-Card-root").first();

async function channelState(page: Page) {
  return (await page.request.get("/api/v1/notifications/channels")).text();
}

test("Telegram: the shared bot links the chat that presses Start with the code", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications/telegram");
  const tg = card(page);
  await expect(
    tg.getByText("This installation's bot is @cloudbank_demo_bot."),
  ).toBeVisible();
  await expect(tg.getByLabel("Chat ID")).toHaveCount(0);
  await tg.getByRole("button", { name: "Connect your chat" }).click();
  const href =
    (await tg
      .getByRole("link", { name: "Connect your chat" })
      .getAttribute("href")) ?? "";
  expect(href).toMatch(
    /^https:\/\/t\.me\/cloudbank_demo_bot\?start=[0-9a-f]{32}$/,
  );
  await expect(
    tg.getByRole("link", { name: "Add to a group" }),
  ).toHaveAttribute("href", href.replace("?start=", "?startgroup="));
  await expect(
    page.getByRole("checkbox", { name: "Bills due" }),
  ).toBeDisabled();

  // A /start without the code links nothing; the one with it links its chat,
  // and the page, which keeps asking, shows it.
  const start = (chat: number, text: string) =>
    page.request.post(`${FAKE}/notify/telegram/start`, {
      data: { chat, text },
    });
  await start(666, "/start");
  await start(424242, `/start ${href.split("=")[1]}`);
  await expect(tg.getByText("Connected: 424242")).toBeVisible({
    timeout: 10_000,
  });
  await tg.getByRole("button", { name: "Send a test" }).click();
  await expect(page.getByText("Test sent")).toBeVisible();
  expect((await chats(page)).at(-1)).toMatchObject({
    hook: "telegram",
    to: "424242",
    sender: "shared",
  });

  // A topic and a silent send are kept with the chat.
  await tg.getByLabel("Topic ID").fill("7");
  await tg.getByRole("switch", { name: "Send silently" }).check();
  await tg.getByRole("button", { name: "Save" }).click();
  // The connect step showed a "Saved" too: wait on the server instead.
  await expect
    .poll(async () => {
      const { channels } = JSON.parse(await channelState(page)) as {
        channels: { channel: string }[];
      };
      return channels.find((c) => c.channel === "telegram");
    })
    .toMatchObject({
      target: "424242",
      pending: false,
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
