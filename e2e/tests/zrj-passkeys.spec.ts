import { expect, test } from "@playwright/test";

// Passkeys (#798), with Chromium's virtual authenticator standing in for the
// phone or the password manager: one is added in Settings › Security, and it
// signs the admin in from the login page with no password and no code. Named
// "zrj-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = { "X-Requested-With": "XMLHttpRequest" };
const ADMIN = { username: "admin", password: "supersecret1" };

test("a passkey added in Settings signs in on its own", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "the virtual authenticator is Chromium's",
  );

  const setup = await page.request.post("/api/v1/setup", {
    headers: H,
    data: ADMIN,
  });
  if (setup.status() === 201) {
    await page.request.post("/api/v1/wallets", {
      headers: H,
      data: { title: "Demo", baseCurrency: "EUR" },
    });
  }
  // A fresh sign-in: adding a passkey needs one from the last 10 minutes.
  await page.request.post("/api/v1/auth/login", { headers: H, data: ADMIN });
  // A run before this one may have left its passkey.
  for (const p of await (
    await page.request.get("/api/v1/auth/me/passkeys")
  ).json()) {
    await page.request.delete(`/api/v1/auth/me/passkeys/${p.id}`, {
      headers: H,
    });
  }
  await page.request.patch("/api/v1/auth/me", {
    headers: H,
    data: { preferences: { tutorialSeen: true, tourOffers: false } },
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/settings/security");
  const card = page.getByTestId("passkeys");
  await expect(card.getByText("None")).toBeVisible();
  await card.getByRole("button", { name: "Add" }).click();
  const dialog = page.getByRole("dialog", { name: "Passkeys" });
  await dialog.getByRole("button", { name: "Add passkey" }).click();
  await expect(dialog.getByText(/Passkey added/)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(
    /^Chrome on /,
  );
  await dialog.getByRole("textbox", { name: "Name" }).fill("E2E key");
  await dialog.getByRole("button", { name: "Save the name" }).click();
  await expect(dialog.getByText("E2E key")).toBeVisible();
  await expect(dialog.getByText("1 of 10")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card.getByText("1 passkey")).toBeVisible();

  // Out, and back in with the passkey alone, from the button. The virtual
  // authenticator answers the username field's offer by itself, so that
  // offer stays off until the next step.
  await page.addInitScript(() => {
    if (localStorage.getItem("e2e-passkey-field")) return;
    Object.defineProperty(
      PublicKeyCredential,
      "isConditionalMediationAvailable",
      {
        value: async () => false,
      },
    );
  });
  await page.request.post("/api/v1/auth/logout", { headers: H });
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.username).toBe(ADMIN.username);

  // And from the username field, where the browser offers it.
  await page.evaluate(() => localStorage.setItem("e2e-passkey-field", "1"));
  await page.request.post("/api/v1/auth/logout", { headers: H });
  await page.goto("/login");
  await expect(page).not.toHaveURL(/\/login/);
  await page.evaluate(() => localStorage.removeItem("e2e-passkey-field"));

  // It shows as used, and goes when removed.
  await page.goto("/settings/security");
  await card.getByRole("button", { name: "Manage" }).click();
  await expect(dialog.getByText(/used today/)).toBeVisible();
  await dialog.getByRole("button", { name: "Remove E2E key" }).click();
  await page
    .getByRole("dialog", { name: 'Remove "E2E key"?' })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(dialog.getByText("E2E key")).toBeHidden();
});
