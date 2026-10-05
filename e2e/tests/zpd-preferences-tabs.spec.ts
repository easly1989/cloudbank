import { type Browser, type Page, expect, test } from "@playwright/test";

// Preferences saved from two tabs, or two devices, keep both changes (#576).
// Each tab or device starts from its own copy; the server refuses a save that
// started from an old revision, and the client makes the change again over the
// stored preferences. Tabs of one browser also tell each other as they save.
// Named "zpd-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

const segment = (page: Page, name: string) =>
  page.locator("label", { hasText: new RegExp(`^${name}`) });

/** Signs in, clears the two preferences under test, and gives the wallet a category. */
async function seed(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const wallet = await page.evaluate(async (h) => {
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
    const {
      categoriesView: _v,
      sidebarCollapsed: _s,
      ...rest
    } = me.preferences ?? {};
    await call("PATCH", "/api/v1/auth/me", {
      preferences: { ...rest, tutorialSeen: true, tourOffers: false },
    });
    const w = await call("POST", "/api/v1/wallets", {
      title: `Tabs ${Date.now()}`,
      baseCurrency: "EUR",
    });
    await call("POST", `/api/v1/wallets/${w.id}/categories`, { name: "Food" });
    return w.id as number;
  }, H);
  await page.evaluate(
    (id) => localStorage.setItem("cb.currentWalletId", String(id)),
    wallet,
  );
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const me = await (await fetch("/api/v1/auth/me")).json();
    return me.preferences as Record<string, unknown>;
  });
}

/** Both changes, made from two copies read before either was saved. */
async function twoChanges(a: Page, b: Page) {
  await a.goto("/categories");
  await b.goto("/categories");
  await expect(segment(a, "Index")).toBeVisible();
  await expect(segment(b, "Index")).toBeVisible();
  await a.waitForLoadState("networkidle");
  await b.waitForLoadState("networkidle");

  const saved = (p: Page) =>
    p.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/auth/me") &&
        r.request().method() === "PATCH" &&
        r.status() === 200,
    );
  const aSaved = saved(a);
  await segment(a, "Index").click();
  await aSaved;
  const bSaved = saved(b);
  await b.getByRole("button", { name: "Toggle sidebar" }).click();
  await bSaved;

  const prefs = await stored(a);
  expect(prefs.categoriesView).toBe("index");
  expect(prefs.sidebarCollapsed).toBe(true);
}

async function restore(page: Page) {
  await page.evaluate(async (h) => {
    const me = await (await fetch("/api/v1/auth/me")).json();
    const {
      categoriesView: _v,
      sidebarCollapsed: _s,
      ...rest
    } = me.preferences ?? {};
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ preferences: rest }),
    });
  }, H);
}

test("two tabs of one browser keep each other's changes", async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page);
  const other = await page.context().newPage();
  const refused: number[] = [];
  other.on("response", (r) => {
    if (r.url().endsWith("/api/v1/auth/me") && r.status() === 409)
      refused.push(r.status());
  });
  try {
    await twoChanges(page, other);
    // The first tab told the second as it saved, so the second saved from an
    // up-to-date copy: never refused.
    expect(refused).toHaveLength(0);
  } finally {
    await restore(page);
    await other.close();
  }
});

test("two devices keep each other's changes", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await seed(page);
  // A second device: its own browser profile, signed in with the same session.
  const device = await (browser as Browser).newContext({
    storageState: await page.context().storageState(),
    viewport: { width: 1440, height: 1000 },
  });
  const phone = await device.newPage();
  const refused: number[] = [];
  phone.on("response", (r) => {
    if (r.url().endsWith("/api/v1/auth/me") && r.status() === 409)
      refused.push(r.status());
  });
  try {
    await twoChanges(page, phone);
    // Nothing told the second device: its save was refused once, then made
    // again over the first device's.
    expect(refused).toHaveLength(1);
  } finally {
    await restore(page);
    await device.close();
  }
});
