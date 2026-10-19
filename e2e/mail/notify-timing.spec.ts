import { expect, test, type Page } from "@playwright/test";

// When notifications arrive (#692), on the real server: with quiet hours on
// around now, a low balance reaches the bell at once but the email channel
// only when the quiet hours are turned off; an event can be moved to the
// digest and back. It runs after notify-money, on the threshold it set.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const FAKE = process.env.E2E_MAIL_FAKE_URL ?? "http://127.0.0.1:9100";
const USER = { username: "admin", password: "supersecret1" };

async function signIn(page: Page) {
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
}

async function lowNotices(page: Page) {
  const res = await page.request.get("/api/v1/notifications", { headers: H });
  return ((await res.json()) as { items: { kind: string }[] }).items.filter(
    (n) => n.kind === "low_balance",
  ).length;
}

async function lowMails(page: Page) {
  const res = await page.request.get(`${FAKE}/notify/received`);
  return ((await res.json()) as { mails: { subject?: string }[] }).mails.filter(
    (m) => m.subject?.includes("Low balance"),
  ).length;
}

async function pick(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("quiet hours hold the mail, not the bell, until they end", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/settings/notifications");
  await page.getByRole("link", { name: /^Timing/ }).click();
  await expect(page).toHaveURL(/\/settings\/notifications\/timing$/);
  await expect(page.getByText(/In your time zone: /)).toBeVisible();

  // From an hour ago to two hours from now, in this browser's time.
  const [from, to] = await page.evaluate(() => {
    const slot = (h: number) => {
      const d = new Date(Date.now() + h * 3_600_000);
      const m = d.getMinutes() < 30 ? "00" : "30";
      return `${String(d.getHours()).padStart(2, "0")}:${m}`;
    };
    return [slot(-1), slot(2)];
  });
  const quiet = page.getByRole("switch", { name: "Quiet hours" });
  await quiet.click();
  await expect(quiet).toBeChecked();
  await pick(page, "Start of quiet hours", from);
  await pick(page, "End of quiet hours", to);
  const before = { bell: await lowNotices(page), mail: await lowMails(page) };

  // A new threshold re-arms the low balance, which the watch tells again.
  await page.goto("/settings/notifications/money");
  const field = page.getByLabel("Balance below, Checking");
  await field.fill("2000000");
  await field.press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();
  await expect
    .poll(() => lowNotices(page), { timeout: 30_000 })
    .toBe(before.bell + 1);
  await page.waitForTimeout(3_000);
  expect(await lowMails(page)).toBe(before.mail);

  await page.goto("/settings/notifications");
  await expect(page.getByText(`quiet ${from}–${to}`)).toBeVisible();
  await page.goto("/settings/notifications/timing");
  await page.getByRole("switch", { name: "Quiet hours" }).click();
  await expect(
    page.getByRole("switch", { name: "Quiet hours" }),
  ).not.toBeChecked();
  await expect
    .poll(() => lowMails(page), { timeout: 30_000 })
    .toBe(before.mail + 1);
});

test("an event moves to the digest and back", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/notifications/timing");
  const digest = async () => {
    const res = await page.request.get("/api/v1/notifications/preferences", {
      headers: H,
    });
    return (
      (await res.json()) as { events: { kind: string; digest: boolean }[] }
    ).events.find((e) => e.kind === "low_balance")?.digest;
  };
  const row = page.getByRole("radiogroup", { name: "Low balance" });
  await row.getByText("In the digest").click();
  await expect.poll(digest).toBe(true);
  await expect(
    page.getByRole("radiogroup", { name: "A sign-in from a new device" }),
  ).toHaveCount(0);
  await expect(page.getByText("Always at once").first()).toBeVisible();
  await row.getByText("At once").click();
  await expect.poll(digest).toBe(false);
});
