import { expect, test, type Page } from "@playwright/test";

// The public demo build (#420): its front door, what it tells the reader, and
// what it leaves out. Runs only against a demo image (npm run test:demo).

async function startDemo(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Try CloudBank" }),
  ).toBeVisible();
  // One button, no form: nothing to sign up for.
  await expect(page.getByLabel("Username")).toHaveCount(0);
  await page.getByRole("button", { name: "Start the demo" }).click();
}

// The tours would offer themselves on every page; these tests are not about them.
async function noTourOffers(page: Page) {
  const res = await page.request.get("/api/v1/auth/me");
  const me = await res.json();
  await page.request.patch("/api/v1/auth/me", {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    data: { preferences: { ...me.preferences, tourOffers: false } },
  });
}

test("one button makes an account, and the demo says what it is", async ({
  page,
}) => {
  await startDemo(page);

  const notice = page.getByRole("dialog", {
    name: "Welcome to the CloudBank demo",
  });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("An update can come at any time of day.");
  await expect(notice).toContainText("The bank connection is a pretend bank.");
  await notice.getByRole("button", { name: "Got it" }).click();
  await expect(notice).toBeHidden();

  const band = page.locator("[data-demo-banner]");
  await expect(band).toContainText("whenever the demo is updated");
  await band.getByRole("button", { name: "What's different here?" }).click();
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Got it" }).click();

  // Read once, the notice does not come back by itself.
  await noTourOffers(page);
  await page.reload();
  await expect(band).toBeVisible();
  await expect(notice).toHaveCount(0);

  // A year of made-up money is there to look at.
  await page.goto("/transactions");
  await expect(page.getByText("Weekly shop").nth(2)).toBeVisible();
});

test("what the demo switched off is not offered", async ({ page }) => {
  await startDemo(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Got it" })
    .click();
  await noTourOffers(page);

  await page.goto("/settings/general");
  const rail = page.getByRole("navigation", { name: "Settings" });
  await expect(rail.getByRole("link", { name: "General" })).toBeVisible();
  for (const gone of ["Security", "People", "Bank sync & AI"]) {
    await expect(rail.getByRole("link", { name: gone })).toHaveCount(0);
  }
  await expect(rail.getByRole("link", { name: "Bank sync" })).toBeVisible();

  await page.goto("/settings/data");
  await expect(
    page.getByRole("button", { name: "Download backup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toHaveCount(0);

  for (const path of ["/api/v1/auth/tokens", "/api/v1/admin/users"]) {
    expect((await page.request.get(path)).status()).toBe(404);
  }
});

test("the pretend bank syncs", async ({ page }) => {
  await startDemo(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Got it" })
    .click();
  await noTourOffers(page);

  await page.goto("/bank-sync");
  await expect(page.getByText("Pretend bank").first()).toBeVisible();
  await expect(page.getByText("SimpleFIN")).toHaveCount(0);
  await page.getByRole("button", { name: "Sync now" }).first().click();
  await expect(page.getByText(/^Imported [1-9]\d*, reconciled/)).toBeVisible();
});
