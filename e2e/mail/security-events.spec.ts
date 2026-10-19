import { expect, test, type Page } from "@playwright/test";

// The security events (#690) on the real server: a sign-in from a client the
// account never used reaches the bell and the email channel the earlier specs
// confirmed, and leads to the Security page; the bell cannot be turned off
// for them. It runs last, on the server the other mail specs set up.
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

async function mailSubjects(page: Page) {
  const res = await page.request.get(`${FAKE}/notify/received`);
  return ((await res.json()) as { mails: { subject?: string }[] }).mails.map(
    (m) => m.subject,
  );
}

test("a sign-in from a new client reaches the bell and the mail, and opens Security", async ({
  page,
  playwright,
  baseURL,
}) => {
  // A script with a user agent the account never signed in with.
  const script = await playwright.request.newContext({
    baseURL,
    userAgent: "e2e-script/1.0",
  });
  const res = await script.post("/api/v1/auth/login", {
    headers: H,
    data: USER,
  });
  expect(res.ok()).toBe(true);
  await script.dispose();

  await signIn(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: /^Notifications, \d+ unread$/ })
    .click();
  const note = page
    .getByRole("button")
    .filter({ hasText: "New sign-in" })
    .filter({ hasText: "from e2e-script" });
  await expect(note).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await mailSubjects(page)).filter((s) => s?.includes("New sign-in"))
          .length,
    )
    .toBe(1);

  await note.click();
  await expect(page).toHaveURL(/\/settings\/security$/);

  // The browser the earlier specs used is no new device.
  await signIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    page.getByRole("button").filter({ hasText: "New sign-in" }),
  ).toHaveCount(1);
});

test("security events cannot leave the bell", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/notifications/inapp");
  await expect(
    page.getByText(
      "Always in the bell, so a sign-in you didn't make cannot go unnoticed.",
    ),
  ).toBeVisible();
  for (const name of [
    "A sign-in from a new device",
    "Two-factor authentication turned off",
    "A new API token",
  ]) {
    const box = page.getByRole("checkbox", { name });
    await expect(box).toBeChecked();
    await expect(box).toBeDisabled();
  }
  await expect(
    page.getByRole("checkbox", { name: "Bank sync fails" }),
  ).toBeEnabled();
  // The administrator also sees the admin events.
  await expect(
    page.getByRole("checkbox", { name: "A new CloudBank version" }),
  ).toBeVisible();

  const refused = await page.request.put("/api/v1/notifications/preferences", {
    headers: H,
    data: { kind: "new_device", channel: "inapp", enabled: false },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error.code).toBe("always_on");
});
