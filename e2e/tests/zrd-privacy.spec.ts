import { expect, type Page, test } from "@playwright/test";

// Privacy mode (#626): one eye beside the ? of every page but Settings, or
// Shift+H, blurs every amount, balance, total, memo and payee across the app,
// and is remembered on the device. "Blurred" is measured, not assumed: every
// visible text that reads as money, or names the wallet's payee or memo, must
// sit under a computed `filter: blur(…)`. On a wallet of its own; named "zrd-"
// so it runs after the main journey, whose admin it reuses, and it also sets
// itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

const PAYEE = "Zephyr Bakery";
const MEMO = "Birthday cake for Ada";

const pad = (n: number) => String(n).padStart(2, "0");
const day = (back: number) => {
  const d = new Date(Date.now() - back * 86400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// Every visible text that reads as money or names a secret, and is not blurred.
function legible(page: Page, secrets: string[]) {
  return page.evaluate((secrets) => {
    const money = /\d[\d.,  ' ]*[.,]\d{2}(?!\d)|[€$£]\s?-?\d|\d\s?[€$£]/;
    const left: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const text = (walker.currentNode.textContent ?? "").trim();
      const el = walker.currentNode.parentElement;
      if (!text || !el || el.closest("script,style")) continue;
      if (!money.test(text) && !secrets.some((s) => text.includes(s))) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      let blurred = false;
      for (let a: Element | null = el; a && !blurred; a = a.parentElement)
        blurred = getComputedStyle(a).filter.includes("blur");
      if (!blurred) left.push(text.slice(0, 60));
    }
    return left;
  }, secrets);
}

test.use({ viewport: { width: 1440, height: 1000 } });

test("privacy mode hides every figure, memo and payee, and survives a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const ids = await page.evaluate(
    async ({ h, payee, memo, days }) => {
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
        title: `Privacy ${Date.now()}`,
        baseCurrency: "EUR",
      });
      const base = `/api/v1/wallets/${w.id}`;
      const acc = await call("POST", `${base}/accounts`, {
        name: "Checking",
        type: "bank",
        initialBalance: 250000,
      });
      const food = await call("POST", `${base}/categories`, { name: "Food" });
      const fuel = await call("POST", `${base}/categories`, { name: "Fuel" });
      const shop = await call("POST", `${base}/payees`, { name: payee });
      await call("PUT", `${base}/budgets/${food.id}`, {
        mode: "same",
        same: -40000,
      });
      for (const [i, back] of days.entries())
        await call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date: back,
          amount: -(1250 + i * 310),
          payeeId: shop.id,
          categoryId: food.id,
          memo,
        });
      const car = await call("POST", `${base}/vehicles`, {
        name: "Car",
        plate: "",
        notes: "",
      });
      for (const [back, d] of [
        [days[2], 10000],
        [days[0], 10600],
      ] as const)
        await call("POST", `${base}/transactions`, {
          accountId: acc.id,
          date: back,
          amount: -5400,
          categoryId: fuel.id,
          vehicleId: car.id,
          memo: `d=${d} v=30 p=1.8`,
        });
      const g = await call("POST", `${base}/goals`, {
        name: "Holiday",
        targetAmount: 120000,
        note: "",
      });
      await call("POST", `${base}/goals/${g.id}/contributions`, {
        date: days[1],
        amount: 30000,
        note: "",
      });
      const tpl = await call("POST", `${base}/templates`, {
        name: "Weekly cake",
        accountId: acc.id,
        amount: -2400,
        payeeId: shop.id,
        categoryId: food.id,
      });
      await call("POST", `${base}/schedules`, {
        templateId: tpl.id,
        unit: "week",
        everyN: 1,
        nextDue: days[0],
        autoPost: false,
      });
      return { wallet: w.id as number, account: acc.id as number };
    },
    { h: H, payee: PAYEE, memo: MEMO, days: [day(1), day(3), day(9)] },
  );
  await page.evaluate((id) => {
    localStorage.setItem("cb.currentWalletId", String(id));
    localStorage.removeItem("cb.privacy");
  }, ids.wallet);
  await page.goto("/");
  const eye = page.getByTestId("privacy-toggle");
  const secrets = [PAYEE, MEMO];

  await test.step("the eye beside the ? turns it on, and says so", async () => {
    await expect.poll(() => legible(page, secrets)).not.toEqual([]);
    await expect(eye).toHaveAttribute("aria-pressed", "false");
    await eye.click();
    await expect(eye).toHaveAttribute("aria-pressed", "true");
    await expect(eye).toHaveAccessibleName("Show amounts");
    await expect(page.locator("html")).toHaveClass(/cb-private/);
  });

  await test.step("a reload keeps it on", async () => {
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/cb-private/);
    await expect(page.getByTestId("privacy-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  for (const path of [
    "/",
    `/transactions/register?accountId=${ids.account}`,
    "/accounts",
    "/budget",
    "/goals",
    "/schedules",
    "/reports",
    "/vehicles",
    "/payees",
    "/templates",
  ]) {
    await test.step(`nothing legible on ${path}`, async () => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("privacy-toggle")).toBeVisible();
      await expect.poll(() => legible(page, secrets)).toEqual([]);
    });
  }

  await test.step("nor in the search", async () => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+K");
    await page.keyboard.type("cake");
    await expect(page.locator(".cb-search-hit").first()).toBeVisible();
    await expect.poll(() => legible(page, secrets)).toEqual([]);
    await page.keyboard.press("Escape");
  });

  await test.step("Settings has no eye", async () => {
    await page.goto("/settings/general");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("privacy-toggle")).toHaveCount(0);
  });

  await test.step("Shift+H turns it off", async () => {
    await page.goto("/budget");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Shift+H");
    await expect(page.locator("html")).not.toHaveClass(/cb-private/);
    await expect(page.getByTestId("privacy-toggle")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect.poll(() => legible(page, secrets)).not.toEqual([]);
  });
});
