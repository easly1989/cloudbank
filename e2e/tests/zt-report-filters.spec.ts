import { expect, test } from "@playwright/test";

// The report pages share one set of filters, the register's, and every one of
// them reaches the server (#487). Transfers between one's own accounts are left
// out unless asked (#489), and a filter that is on says so as a chip.
//
// Named "zt-" so it runs after the main journey, whose admin it reuses; it also
// sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test("transfers are left out until the filters say otherwise", async ({
  page,
}) => {
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

  const statistics = (pred: (u: URL) => boolean) =>
    page.waitForRequest((r) => {
      if (!r.url().includes("/reports/statistics?")) return false;
      return pred(new URL(r.url()));
    });

  const first = statistics(() => true);
  await page.goto("/reports");
  expect(new URL((await first).url()).searchParams.get("transfers")).toBe(
    "none",
  );

  await page.getByRole("button", { name: /^Filters/ }).click();
  const drawer = page.getByRole("dialog", { name: "Filters" });
  await drawer.getByRole("combobox", { name: "Transfers" }).click();
  const all = statistics((u) => !u.searchParams.has("transfers"));
  await page.getByRole("option", { name: "All", exact: true }).click();
  await all;
  // The period bar owns the dates: the panel has no date range of its own.
  await expect(
    drawer.getByRole("combobox", { name: "Date range" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The choice is in the URL, and on a chip that takes it back.
  await expect(page).toHaveURL(/xf=all/);
  const chip = page.getByRole("button", {
    name: "Remove the Including transfers filter",
  });
  const none = statistics((u) => u.searchParams.get("transfers") === "none");
  await chip.click();
  await none;
  await expect(page).not.toHaveURL(/xf=/);
});
