import { expect, test } from "@playwright/test";

// The new-version check (#582), as an admin meets it on a local build: the
// build follows no release channel, so it never goes online, and Settings ›
// About says so. (A versioned build and its card are covered by the Go and
// unit tests: the e2e image is built as "dev".)
// Named "zpg-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test("Settings › About tells an admin what the update check does", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const status = await page.evaluate(async (h) => {
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await fetch(url, {
        method,
        headers: h,
        body: body ? JSON.stringify(body) : undefined,
      });
      return r.status === 204 ? null : r.json();
    };
    const needsSetup = (await call("GET", "/api/v1/setup/status"))
      .needsSetup as boolean;
    await call(
      "POST",
      needsSetup ? "/api/v1/setup" : "/api/v1/auth/login",
      needsSetup
        ? { username: "admin", email: "a@b.com", password: "supersecret1" }
        : { username: "admin", password: "supersecret1" },
    );
    const me = await call("GET", "/api/v1/auth/me");
    await call("PATCH", "/api/v1/auth/me", {
      preferences: { ...me.preferences, tutorialSeen: true, tourOffers: false },
    });
    return call("GET", "/api/v1/admin/updates");
  }, H);
  expect(status.channel).toBe("");
  expect(status.available).toBe(false);

  await page.goto("/settings/about");
  await expect(
    page.getByText(/This is a local build, which follows no release channel/),
  ).toBeVisible();
  // No card at the foot of the menu: nothing is out, and nothing was asked.
  await page.goto("/");
  await expect(page.getByRole("region", { name: /is out/ })).toHaveCount(0);
});
