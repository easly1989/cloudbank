import { expect, test } from "@playwright/test";

// The schedules in a phone's calendar (#694): from the calendar view, the
// reader makes a private address, a calendar app (no session) reads it, and a
// regenerated or turned-off address answers 404. On a wallet of its own;
// named "zru-" so it runs after the main journey, whose admin it reuses, and
// it also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("the schedules are added to a calendar at a private address", async ({
  page,
  playwright,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const wallet = await page.evaluate(
    async ({ h }) => {
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
        preferences: {
          ...(me.preferences ?? {}),
          tutorialSeen: true,
          tourOffers: false,
        },
      });
      const w = await call("POST", "/api/v1/wallets", {
        title: `Calendar feed ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "checking",
      });
      const payee = await call("POST", `${base}/payees`, { name: "Power Co" });
      const tpl = await call("POST", `${base}/templates`, {
        name: "Electricity",
        accountId: acc.id,
        amount: -6450,
        payeeId: payee.id,
      });
      const next = new Date(Date.now() + 5 * 86400_000)
        .toISOString()
        .slice(0, 10);
      await call("POST", `${base}/schedules`, {
        templateId: tpl.id,
        unit: "month",
        everyN: 1,
        nextDue: next,
        autoPost: false,
      });
      return w.id as number;
    },
    { h: H },
  );
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    wallet,
  );

  await page.goto("/schedules?view=list");
  await expect(
    page.getByRole("button", { name: "Add to calendar" }),
  ).toHaveCount(0);
  await page.goto("/schedules");
  await page.getByRole("button", { name: "Add to calendar" }).click();
  const sheet = page.getByTestId("calendar-feed-sheet");
  await sheet.getByRole("button", { name: "Create the address" }).click();
  const field = sheet.getByTestId("calendar-feed-url");
  await expect(field).toHaveValue(/\/ical\/\d+\/[\w-]{43}\.ics$/);
  const url = await field.inputValue();

  // A calendar app: a fresh context, no cookies.
  const app = await playwright.request.newContext();
  const first = await app.get(url);
  expect(first.status()).toBe(200);
  expect(first.headers()["content-type"]).toContain("text/calendar");
  const body = await first.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  // The wallet's euro writes the decimal as a dot or an escaped comma.
  expect(body).toMatch(/SUMMARY:Electricity · -64(\.|\\,)50 €/);

  await test.step("a regenerated address replaces the old one", async () => {
    await sheet.getByRole("button", { name: "Regenerate the address" }).click();
    await page
      .getByRole("dialog", { name: "Regenerate the address?" })
      .getByRole("button", { name: "Regenerate the address" })
      .click();
    await expect(field).not.toHaveValue(url);
    expect((await app.get(url)).status()).toBe(404);
    expect((await app.get(await field.inputValue())).status()).toBe(200);
  });

  await test.step("a turned-off address stops answering", async () => {
    const current = await field.inputValue();
    await sheet.getByRole("button", { name: "Turn off" }).click();
    await page
      .getByRole("dialog", { name: "Turn the address off?" })
      .getByRole("button", { name: "Turn off" })
      .click();
    await expect(
      sheet.getByRole("button", { name: "Create the address" }),
    ).toBeVisible();
    expect((await app.get(current)).status()).toBe(404);
  });
  await app.dispose();
});
