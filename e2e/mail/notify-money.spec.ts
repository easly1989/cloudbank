import { expect, test, type Page } from "@playwright/test";

// The money events (#691) on the real server, with the money looked at every
// two seconds (CB_MONEY_INTERVAL): a balance threshold set on the thresholds
// page reaches the bell with the amounts, and the email channel the earlier
// spec confirmed without them; a wallet left out is saved as such.
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

async function bell(page: Page) {
  const res = await page.request.get("/api/v1/notifications", { headers: H });
  return ((await res.json()) as { items: { kind: string; body: string }[] })
    .items;
}

async function mails(page: Page) {
  const res = await page.request.get(`${FAKE}/notify/received`);
  return (
    (await res.json()) as { mails: { subject?: string; body?: string }[] }
  ).mails;
}

test("a low balance reaches the bell with the amount, and the mail without", async ({
  page,
}) => {
  await signIn(page);
  // Off by default: turned on for the bell and the email channel.
  for (const channel of ["inapp", "email"]) {
    await page.goto(`/settings/notifications/${channel}`);
    const box = page.getByRole("checkbox", { name: "Low balance" });
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(box).toBeChecked();
  }

  await page.goto("/settings/notifications");
  await page.getByRole("link", { name: /^Thresholds and wallets/ }).click();
  await expect(page).toHaveURL(/\/settings\/notifications\/money$/);
  const amounts = page.getByRole("switch", {
    name: "Show amounts outside the app",
  });
  await expect(amounts).toBeChecked();
  await amounts.click();
  await expect(amounts).not.toBeChecked();

  const field = page.getByLabel("Balance below, Checking");
  await field.fill("1000000");
  await field.press("Enter");
  await expect(page.getByText("Saved")).toBeVisible();

  await expect
    .poll(async () =>
      (await bell(page)).filter((n) => n.kind === "low_balance"),
    )
    .toHaveLength(1);
  const [note] = (await bell(page)).filter((n) => n.kind === "low_balance");
  expect(note.body).toMatch(/^Checking is at .+, below .+\.$/);
  await expect
    .poll(async () =>
      (await mails(page)).filter((m) => m.subject?.includes("Low balance")),
    )
    .toHaveLength(1);
  const mail = (await mails(page)).find((m) =>
    m.subject?.includes("Low balance"),
  );
  expect(mail?.body).toContain("Checking is below its threshold.");
  expect(mail?.body).not.toContain("1.000.000");
  expect(mail?.body).not.toContain("1,000,000");

  // Once while it stays below, and it opens the account.
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const item = page.getByRole("button").filter({ hasText: "Low balance" });
  await expect(item).toHaveCount(1);
  await item.click();
  await expect(page).toHaveURL(/\/transactions\?account=\d+$/);
});

test("a wallet left out is saved for this person", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/notifications/money");
  const box = page.getByRole("checkbox").first();
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  await page.goto("/settings/notifications");
  await expect(page.getByText(/1 wallet left out/)).toBeVisible();

  await page.goto("/settings/notifications/money");
  await page.getByRole("checkbox").first().click();
  await expect(page.getByRole("checkbox").first()).toBeChecked();
});
