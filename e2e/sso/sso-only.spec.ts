import { expect, test, type Page } from "@playwright/test";

// A server that signs in through SSO only (#620), from its first sign-in to a
// recovery code. The steps build on each other — the first sign-in makes the
// admin, whose codes the later steps use — so they run in order.
test.describe.configure({ mode: "serial" });

const ADMIN = "admin@example.com";
const H = { "X-Requested-With": "XMLHttpRequest" };
let codes: string[] = [];

// signInAs goes through the pretend provider's page as email.
async function signInAs(page: Page, email: string) {
  await page.getByRole("link", { name: /^Sign in with / }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("the setup page is the provider's button, and the first sign-in is reserved", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await expect(
    page.getByText("The first sign-in becomes the administrator"),
  ).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);

  // CB_OIDC_ADMIN_EMAIL is someone else: refused, still to set up.
  await signInAs(page, "eve@example.com");
  await expect(page).toHaveURL(/\/setup\?sso_error=account/);
  await expect(page.getByText(/reserved to the administrator/)).toBeVisible();

  // The reserved email becomes the administrator.
  await signInAs(page, ADMIN);
  await expect(page).not.toHaveURL(/\/(setup|login)/);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.isAdmin).toBe(true);
  expect(me.username).toBe("admin");
  // A wallet, and no tours, so Settings opens straight away later on.
  await page.request.patch("/api/v1/auth/me", {
    headers: H,
    data: { preferences: { tutorialSeen: true, tourOffers: false } },
  });
  const wallet = await page.request.post("/api/v1/wallets", {
    headers: H,
    data: { title: "Demo", baseCurrency: "EUR" },
  });
  expect(wallet.status()).toBe(201);
});

test("Security keeps recovery codes in place of password and two-factor", async ({
  page,
}) => {
  await page.goto("/login");
  await signInAs(page, ADMIN);
  await page.goto("/settings/security");
  const card = page.getByTestId("access-codes");
  await expect(card).toBeVisible();
  await expect(page.getByText("Two-factor authentication")).toHaveCount(0);
  await expect(page.getByLabel("Current password")).toHaveCount(0);

  await card.getByRole("button", { name: "Make recovery codes" }).click();
  await expect(card.getByText("10 of 10 codes still valid.")).toBeVisible();
  codes = await card.locator(".mantine-SimpleGrid-root p").allTextContents();
  expect(codes).toHaveLength(10);
  expect(codes[0]).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  await expect(
    card.getByRole("button", { name: "Download as a file" }),
  ).toBeVisible();
});

test("the login page has no password form, and the server refuses one", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: /^Sign in with / }),
  ).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  const res = await page.request.post("/api/v1/auth/login", {
    headers: H,
    data: { username: "admin", password: "whatever-it-is" },
  });
  expect(res.status()).toBe(403);
});

test("a recovery code lets you in once", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use a recovery code" }).click();
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Recovery code").fill(codes[0].toLowerCase());
  await page.getByRole("button", { name: "Sign in with the code" }).click();
  await expect(
    page.getByText("You signed in with a recovery code. You have 9 left."),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  // The same code, from another browser: refused.
  const other = await browser.newPage();
  await other.goto("/login");
  await other.getByRole("button", { name: "Use a recovery code" }).click();
  await other.getByLabel("Username").fill("admin");
  await other.getByLabel("Recovery code").fill(codes[0]);
  await other.getByRole("button", { name: "Sign in with the code" }).click();
  await expect(
    other.getByText("Invalid username or recovery code"),
  ).toBeVisible();
  await other.close();
});

test("people are added with an email, and sign in through the provider", async ({
  page,
}) => {
  await page.goto("/login");
  await signInAs(page, ADMIN);
  const res = await page.request.post("/api/v1/admin/users", {
    headers: H,
    data: { username: "bob", email: "bob@example.com", isAdmin: false },
  });
  expect(res.status()).toBe(201);
  await page.request.post("/api/v1/auth/logout", { headers: H });

  await page.goto("/login");
  await signInAs(page, "bob@example.com");
  await expect(page).not.toHaveURL(/\/login/);
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.username).toBe("bob");
  expect(me.isAdmin).toBe(false);
});
