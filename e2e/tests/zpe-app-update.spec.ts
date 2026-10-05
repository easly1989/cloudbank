import http from "node:http";
import type { AddressInfo } from "node:net";

import { type Page, expect, test } from "@playwright/test";

// A new build reaches a page left open on the old one (#578). The server says
// 404 for a chunk it no longer has, instead of serving the app shell as code;
// the page reloads once onto the new build when that happens; and a new build
// is offered in a notice, never swapped in under the open page.
// Named "zpe-" so it runs after the main journey, whose admin it reuses; it
// also sets itself up when run alone.

const H = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

test.use({ viewport: { width: 1440, height: 1000 } });

async function signIn(page: Page, origin = "") {
  await page.goto(`${origin}/`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async (h) => {
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
    const wallets = await call("GET", "/api/v1/wallets");
    if (!wallets.length)
      await call("POST", "/api/v1/wallets", {
        title: "Update",
        baseCurrency: "EUR",
      });
  }, H);
  await page.goto(`${origin}/`);
  await page.waitForLoadState("networkidle");
}

test("a missing file is a 404 and the shell is always asked again", async ({
  request,
}) => {
  const shell = await request.get("/");
  expect(shell.headers()["cache-control"]).toBe("no-cache");
  const route = await request.get("/transactions");
  expect(route.status()).toBe(200);
  expect(route.headers()["content-type"]).toContain("text/html");

  const html = await shell.text();
  const script = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
  expect(script).toBeTruthy();
  const asset = await request.get(script!);
  expect(asset.headers()["cache-control"]).toContain("immutable");

  const gone = await request.get("/assets/VehiclesPage-oldbuild.js");
  expect(gone.status()).toBe(404);
  expect(gone.headers()["content-type"] ?? "").not.toContain("text/html");
});

test.describe("without a service worker", () => {
  test.use({ serviceWorkers: "block" });

  test("a page whose code is gone reloads once onto the new build", async ({
    page,
  }) => {
    await signIn(page);
    let loads = 0;
    page.on("load", () => loads++);
    // The open page is the old build: its Vehicles chunk is no longer there.
    let missing = true;
    await page.route(/\/assets\/VehiclesPage-[\w-]+\.js$/, (route) => {
      if (!missing) return route.continue();
      missing = false;
      return route.fulfill({ status: 404, body: "404 page not found" });
    });
    await page.getByRole("link", { name: "Vehicles" }).first().click();
    await expect(page.getByRole("heading", { name: "Vehicles" })).toBeVisible();
    expect(loads).toBe(1);
    await expect(page.getByText("This page stopped working")).toHaveCount(0);
  });

  test("a chunk that keeps failing shows the error, not a reload loop", async ({
    page,
  }) => {
    await signIn(page);
    let loads = 0;
    page.on("load", () => loads++);
    await page.route(/\/assets\/VehiclesPage-[\w-]+\.js$/, (route) =>
      route.fulfill({ status: 404, body: "404 page not found" }),
    );
    await page.getByRole("link", { name: "Vehicles" }).first().click();
    await expect(page.getByText("This page stopped working")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(loads).toBe(1);
  });
});

/**
 * The app behind a proxy that can start serving a "new build": the same app
 * with a service worker one byte longer. Playwright cannot route the browser's
 * own update check of a worker script, so the server side has to change.
 */
async function startProxy(target: string) {
  let nextBuild = false;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", target);
    const headers = { ...req.headers, "accept-encoding": "identity" };
    const upstream = http.request(
      url,
      { method: req.method, headers },
      (up) => {
        if (!(nextBuild && url.pathname === "/sw.js")) {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        up.on("data", (c: Buffer) => chunks.push(c));
        up.on("end", () => {
          const body = Buffer.concat([
            ...chunks,
            Buffer.from("\n// next build\n"),
          ]);
          res.writeHead(up.statusCode ?? 200, {
            ...up.headers,
            "content-length": String(body.length),
          });
          res.end(body);
        });
      },
    );
    req.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    release: () => {
      nextBuild = true;
    },
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("a new build is offered, and switched to only when chosen", async ({
  page,
  baseURL,
}) => {
  const proxy = await startProxy(baseURL ?? "http://localhost:8080");
  try {
    await signIn(page, proxy.origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(() => !!navigator.serviceWorker.controller),
    ).toBe(true);

    const notice = page.getByRole("status", { name: /new version/i });
    const comeBack = () =>
      page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
    let loads = 0;
    page.on("load", () => loads++);

    // The server moves to a new build; coming back to the app asks again.
    proxy.release();
    await comeBack();
    await expect(notice).toBeVisible();

    // Later hides it until the next check; the page has not moved.
    await notice.getByRole("button", { name: "Later" }).click();
    await expect(notice).toBeHidden();
    await comeBack();
    await expect(notice).toBeVisible();
    expect(loads).toBe(0);

    // Update: the new worker takes over and the page reloads onto it.
    await notice.getByRole("button", { name: "Update" }).click();
    await expect.poll(() => loads).toBe(1);
    await page.waitForLoadState("networkidle");
    await expect(notice).toBeHidden();
    const waiting = await page.evaluate(
      async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
    );
    expect(waiting).toBe(false);
  } finally {
    await page.close();
    await proxy.close();
  }
});
