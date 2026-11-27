import { expect, test } from "@playwright/test";

// Single sign-on set from Settings (#796), on a password-login server with
// CB_SECRET_KEY and no CB_OIDC_* variables, through the pretend provider in
// fake-idp.mjs. The steps build on each other, so they run in order.
test.describe.configure({ mode: "serial" });

const H = { "X-Requested-With": "XMLHttpRequest" };
const ADMIN = {
  username: "admin",
  email: "admin@example.com",
  password: "supersecret1",
};
const ISSUER = "http://localhost:9000";

test("an administrator turns SSO on from Settings, without a restart", async ({
  page,
}) => {
  const setup = await page.request.post("/api/v1/setup", {
    headers: H,
    data: ADMIN,
  });
  expect(setup.status()).toBe(201);
  await page.request.patch("/api/v1/auth/me", {
    headers: H,
    data: { preferences: { tutorialSeen: true, tourOffers: false } },
  });
  await page.request.post("/api/v1/wallets", {
    headers: H,
    data: { title: "Demo", baseCurrency: "EUR" },
  });

  await page.goto("/settings/admin");
  const row = page.getByTestId("sso-settings");
  await expect(row.getByText("No provider")).toBeVisible();
  await row.getByRole("button", { name: "Configure" }).click();

  const dialog = page.getByRole("dialog");
  // A provider that does not answer: nothing is saved, the reason is under the field.
  await dialog.getByLabel("Provider (issuer)").fill("http://localhost:9");
  await dialog.getByLabel("Client ID").fill("cloudbank");
  await dialog.getByLabel("Client secret").fill("e2e-only");
  await dialog.getByLabel("Button name").fill("Fake IdP");
  await dialog.getByRole("button", { name: "Check and turn on" }).click();
  await expect(
    dialog.getByText(/CloudBank cannot find the provider/),
  ).toBeVisible();

  await dialog.getByLabel("Provider (issuer)").fill(ISSUER);
  await dialog.getByRole("button", { name: "Check and turn on" }).click();
  await expect(dialog).toBeHidden();
  await expect(row.getByText(/Provider reachable/)).toBeVisible();

  // Opened again, the form has what was saved, and never the secret.
  await row.getByRole("button", { name: "Edit" }).click();
  await expect(dialog.getByLabel("Provider (issuer)")).toHaveValue(ISSUER);
  await expect(dialog.getByLabel("Client secret")).toHaveValue("");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  const settings = await (await page.request.get("/api/v1/admin/oidc")).json();
  expect(settings).toMatchObject({
    source: "settings",
    enabled: true,
    hasSecret: true,
  });
  expect(JSON.stringify(settings)).not.toContain("e2e-only");
});

test("the login page offers the provider, and it signs the admin in", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Sign in with Fake IdP" }).click();
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.username).toBe("admin");
});

test("turning it off takes the button away", async ({ page }) => {
  await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  await page.goto("/settings/admin");
  await page
    .getByTestId("sso-settings")
    .getByRole("button", { name: "Edit" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Turn single sign-on off" })
    .click();
  // It asks first, and says the linked account will need a password.
  const confirm = page.getByRole("dialog", {
    name: "Turn single sign-on off?",
  });
  await expect(confirm.getByText(/linked accounts? will need/)).toBeVisible();
  await confirm.getByRole("button", { name: "Turn off" }).click();
  await expect(
    page.getByTestId("sso-settings").getByText("No provider"),
  ).toBeVisible();

  await page.request.post("/api/v1/auth/logout", { headers: H });
  await page.goto("/login");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Sign in with / })).toHaveCount(
    0,
  );
});
