// Times the main pages in a real browser (Chromium from the e2e suite).
// See ../speed-baseline.md for how to run it.
//   node pages.mjs <base> <label> [creds.json]
// With no creds file it starts a demo session (demo build only). Writes
// out/pages-<label>.json and prints a table.
//
// "Page ready" is the moment the last wallet-scoped /api/ response of the load
// finished (the page's own data), measured from navigation start, once no new
// request has started for 2 s. "Quiet" is the same for every /api/ call,
// including the app frame's background ones (notifications, AI settings).
// LCP is the browser's largest-contentful-paint entry. Long tasks add up the
// main-thread time past 50 ms per task (what Lighthouse calls TBT, but from
// navigation start until the page is quiet, rather than FCP to TTI).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(
  pathToFileURL(resolve(here, "../../../e2e/node_modules/playwright/index.mjs")).href
);

const [BASE, label = "run", credsPath] = process.argv.slice(2);
if (!BASE) throw new Error("usage: node pages.mjs <base> <label> [creds.json]");
const OUT = resolve(here, "out");
mkdirSync(OUT, { recursive: true });
const RUNS = Number(process.env.RUNS ?? 3);
const H = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };

const PAGES = [
  ["dashboard", "/"],
  ["register", "/transactions"],
  ["reports", "/reports"],
  ["budget", "/budget"],
  ["scheduled", "/schedules"],
];

// Two profiles: this machine as it is, and a Lighthouse-like slow phone
// (4x CPU slowdown, 150 ms RTT, 1.6 Mbit/s down, 750 kbit/s up).
const PROFILES = {
  desktop: null,
  "slow phone": { cpu: 4, latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
};

const INIT = () => {
  performance.setResourceTimingBufferSize(2000);
  window.__perf = { lcp: 0, longTasks: 0 };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__perf.longTasks += Math.max(0, e.duration - 50);
  }).observe({ type: "longtask", buffered: true });
};

async function signIn(ctx) {
  const api = ctx.request;
  if (credsPath) {
    const creds = JSON.parse(readFileSync(credsPath, "utf8"));
    const r = await api.post(BASE + "/api/v1/auth/login", { headers: H, data: creds });
    if (!r.ok()) throw new Error(`login ${r.status()}`);
  } else {
    const r = await api.post(BASE + "/api/v1/demo/session", { headers: H });
    if (!r.ok()) throw new Error(`demo session ${r.status()}`);
  }
  await api.patch(BASE + "/api/v1/auth/me", {
    headers: H,
    data: { preferences: { tutorialSeen: true, tourOffers: false, demoNoticeSeen: true } },
  });
  const wallets = await (await api.get(BASE + "/api/v1/wallets", { headers: H })).json();
  return wallets[0].id;
}

async function newContext(browser, walletId, storageState) {
  const ctx = await browser.newContext({
    serviceWorkers: "block", // a cold load must not come from the precache
    viewport: { width: 1440, height: 900 },
    storageState,
  });
  await ctx.addInitScript(INIT);
  await ctx.addInitScript((id) => localStorage.setItem("cb.currentWalletId", String(id)), walletId);
  return ctx;
}

async function throttle(page, p) {
  if (!p) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: p.latency,
    downloadThroughput: p.down,
    uploadThroughput: p.up,
  });
}

async function measure(page, url) {
  const api = [];
  const onDone = async (req) => {
    if (!req.url().includes("/api/")) return;
    const s = await req.sizes().catch(() => null);
    api.push({ url: req.url().replace(BASE, ""), body: s?.responseBodySize ?? 0 });
  };
  page.on("requestfinished", onDone);
  await page.goto(BASE + url, { waitUntil: "load", timeout: 180_000 });
  // Quiet means no new resource entry for 2 s (networkidle alone fires too
  // early on a throttled CPU, while a chunk is still being parsed).
  let seen = -1;
  for (let n = 0; n < 120; n++) {
    await page.waitForLoadState("networkidle", { timeout: 180_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const now = await page.evaluate(() => performance.getEntriesByType("resource").length);
    if (now === seen) break;
    seen = now;
  }
  page.off("requestfinished", onDone);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const res = performance.getEntriesByType("resource");
    const apiRes = res.filter((r) => r.name.includes("/api/"));
    const js = res.filter((r) => r.name.endsWith(".js") || r.name.endsWith(".css"));
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      calls: apiRes.map((r) => [
        r.name.replace(location.origin, "").replace(/\/api\/v1\/wallets\/\d+/, "W"),
        Math.round(r.startTime),
        Math.round(r.responseEnd),
      ]),
      ready: Math.max(
        nav.domContentLoadedEventEnd,
        ...apiRes.filter((r) => /\/api\/v1\/wallets\/\d+\//.test(r.name)).map((r) => r.responseEnd),
      ),
      quiet: Math.max(nav.domContentLoadedEventEnd, ...apiRes.map((r) => r.responseEnd)),
      dcl: nav.domContentLoadedEventEnd,
      fcp: fcp?.startTime ?? 0,
      lcp: window.__perf.lcp,
      longTasks: window.__perf.longTasks,
      apiCalls: apiRes.length,
      assetFiles: js.length,
      assetBytes: js.reduce((a, r) => a + r.transferSize, 0),
      heap: performance.memory?.usedJSHeapSize ?? 0,
    };
  });
  m.apiBytes = api.reduce((a, r) => a + r.body, 0);
  m.apiList = api.map((r) => r.url.split("?")[0].replace(/\/api\/v1\/wallets\/\d+/, "W"));
  return m;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pick = (runs) => {
  const out = {};
  for (const k of Object.keys(runs[0])) {
    out[k] = typeof runs[0][k] === "number" ? median(runs.map((r) => r[k])) : runs[0][k];
  }
  return out;
};

const browser = await chromium.launch();
const login = await browser.newContext();
const walletId = await signIn(login);
const state = await login.storageState();
await login.close();

const results = {};
const fmt = (n) => String(Math.round(n)).padStart(7);
console.log(`${"page".padEnd(10)} ${"profile".padEnd(10)} ${"kind".padEnd(5)}   ready   quiet     fcp     lcp longtsk  api  apiKB assetKB heapMB`);
// ONLY=idle skips the timings and the navigation and runs only the idle tab.
const ONLY = process.env.ONLY;
for (const [profile, p] of ONLY ? [] : Object.entries(PROFILES)) {
  for (const [name, url] of PAGES) {
    const cold = [];
    const warm = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await newContext(browser, walletId, state);
      const page = await ctx.newPage();
      await throttle(page, p);
      cold.push(await measure(page, url));
      warm.push(await measure(page, url)); // same context: assets in the HTTP cache
      await ctx.close();
    }
    for (const [kind, runs] of [["cold", cold], ["warm", warm]]) {
      const m = pick(runs);
      results[`${name}|${profile}|${kind}`] = { ...m, runs };
      console.log(
        `${name.padEnd(10)} ${profile.padEnd(10)} ${kind.padEnd(5)} ${fmt(m.ready)} ${fmt(m.quiet)} ${fmt(m.fcp)} ${fmt(m.lcp)} ${fmt(m.longTasks)} ${String(m.apiCalls).padStart(4)} ${fmt(m.apiBytes / 1024)} ${fmt(m.assetBytes / 1024)} ${fmt(m.heap / 1048576)}`,
      );
    }
  }
}

// In-app navigation: dashboard → register → dashboard, one context, counting
// the API calls each step makes (what TanStack Query refetches).
if (!ONLY) {
  const ctx = await newContext(browser, walletId, state);
  const page = await ctx.newPage();
  const calls = [];
  page.on("request", (r) => r.url().includes("/api/") && calls.push(r.url()));
  const step = async (name, act) => {
    calls.length = 0;
    const t = Date.now();
    await act();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1000);
    results[`nav|${name}`] = { apiCalls: calls.length, ms: Date.now() - t - 1000 };
    console.log(`nav ${name.padEnd(28)} api calls ${calls.length}`);
  };
  await step("load dashboard", () => page.goto(BASE + "/"));
  await step("click to register", () => page.locator('a[href="/transactions"]').first().click());
  await step("click back to dashboard", () => page.locator('a[href="/"]').first().click());
  await ctx.close();
}

// An open tab left alone: what it asks for in 2 minutes after its first load
// (the 30 s polling of queryClient.ts).
for (const [name, url] of [["dashboard", "/"], ["register", "/transactions"]]) {
  const ctx = await newContext(browser, walletId, state);
  const page = await ctx.newPage();
  await measure(page, url);
  const seen = [];
  page.on("requestfinished", async (r) => {
    if (!r.url().includes("/api/")) return;
    const s = await r.sizes().catch(() => null);
    seen.push(s?.responseBodySize ?? 0);
  });
  await page.waitForTimeout(120_000);
  const kb = seen.reduce((a, b) => a + b, 0) / 1024;
  results[`idle|${name}`] = { apiCalls: seen.length, kb };
  console.log(`idle ${name.padEnd(10)} 2 min: ${seen.length} api calls, ${Math.round(kb)} KB`);
  await ctx.close();
}

await browser.close().catch(() => {});
writeFileSync(resolve(OUT, `pages-${label}.json`), JSON.stringify(results, null, 1));
