import { expect, test } from "@playwright/test";

// The report pages show the register's filter panel, and every filter in it
// reaches the server (#487). Before, "Transfers", "Hide future", "No status" and
// "Uncategorised" were shown and silently dropped.
//
// Named "zt-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test("excluding transfers reaches the trend report", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (h) => {
    const needsSetup = (await (await fetch("/api/v1/setup/status")).json())
      .needsSetup as boolean;
    await fetch(needsSetup ? "/api/v1/setup" : "/api/v1/auth/login", {
      method: "POST",
      headers: h,
      body: JSON.stringify(
        needsSetup
          ? { username: "admin", email: "a@b.com", password: "supersecret1" }
          : { username: "admin", password: "supersecret1" },
      ),
    });
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({
        preferences: { tutorialSeen: true, tourOffers: false },
      }),
    });
    const wallets = await (await fetch("/api/v1/wallets")).json();
    if (!Array.isArray(wallets) || wallets.length === 0) {
      await fetch("/api/v1/wallets", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ title: "Reports", baseCurrency: "EUR" }),
      });
    }
  }, H);

  await page.goto("/reports");
  await page.getByRole("tab", { name: "Trend" }).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("combobox", { name: "Transfers" }).click();

  const request = page.waitForRequest(
    (r) =>
      r.url().includes("/reports/trend") && r.url().includes("transfers=none"),
  );
  await page.getByRole("option", { name: "Exclude transfers" }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get("transfers")).toBe("none");
});
