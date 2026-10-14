// One picture per language (#614): every page on a 390px phone, plus the
// entry sheet, the sign-in page and Settings › General, side by side. A
// reviewer of a translation looks at it once instead of opening the app in
// that language page by page.
//
//   E2E_BASE_URL=http://localhost:8080 node i18n/sheet.mjs [lang ...]
//
// Runs against the demo build, like the language check. With no languages it
// makes a sheet for each translation file. Writes test-results/i18n-sheets/<lang>.png.
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, request } from "@playwright/test";

import { PAGES } from "../pages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.E2E_BASE_URL ?? "http://localhost:8080";
const out = join(here, "..", "test-results", "i18n-sheets");
const width = 390;
const height = 844;
/** A page taller than this is cut: the sheet is for looking, not scrolling. */
const tallest = 1600;

const languages = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(join(here, "..", "..", "web", "src", "i18n", "locales"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));

const SHOTS = [
  ...PAGES.map((path) => ({ path, label: path })),
  { path: "/transactions?new=1", label: "entry sheet" },
  { path: "/settings/general", label: "/settings/general" },
  { path: "/login", label: "/login", signedOut: true },
];

async function demoSession(lang) {
  const ctx = await request.newContext({
    baseURL: base,
    extraHTTPHeaders: { "Accept-Language": lang, "X-Requested-With": "XMLHttpRequest" },
  });
  const res = await ctx.post("/api/v1/demo/session");
  if (!res.ok()) throw new Error(`demo session for ${lang}: ${res.status()}`);
  await ctx.patch("/api/v1/auth/me", {
    data: { preferences: { demoNoticeSeen: true, tourOffers: false, tutorialSeen: true } },
  });
  const state = await ctx.storageState();
  await ctx.dispose();
  return state;
}

async function shoot(browser, lang, state, shot) {
  const ctx = await browser.newContext({
    baseURL: base,
    locale: lang,
    viewport: { width, height },
    storageState: shot.signedOut ? undefined : state,
  });
  const page = await ctx.newPage();
  await page.goto(shot.path);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  const png = await page.screenshot({
    fullPage: true,
    clip: { x: 0, y: 0, width, height: Math.min(full, tallest) },
  });
  await ctx.close();
  return png.toString("base64");
}

function sheetHtml(lang, tiles) {
  const cells = tiles
    .map(
      ({ label, png }) =>
        `<figure><img src="data:image/png;base64,${png}"><figcaption>${label}</figcaption></figure>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #e9ecef; font: 14px system-ui, sans-serif; }
    h1 { margin: 0 0 16px; font-size: 20px; }
    main { display: grid; grid-template-columns: repeat(7, ${width}px); gap: 20px; align-items: start; }
    figure { margin: 0; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 0.2); }
    img { display: block; width: ${width}px; }
    figcaption { padding: 6px 10px; font-family: ui-monospace, monospace; font-size: 13px; }
  </style><h1>CloudBank · ${lang} · ${width}px</h1><main>${cells}</main>`;
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const lang of languages) {
  const state = await demoSession(lang);
  const tiles = [];
  for (const shot of SHOTS) {
    tiles.push({ label: shot.label, png: await shoot(browser, lang, state, shot) });
  }
  const ctx = await browser.newContext({ viewport: { width: 7 * width + 6 * 20 + 48, height: 800 } });
  const page = await ctx.newPage();
  await page.setContent(sheetHtml(lang, tiles));
  const file = join(out, `${lang}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
  console.log(file);
}
await browser.close();
