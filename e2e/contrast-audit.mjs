// WCAG 1.4.3 contrast audit against a running CloudBank.
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npm ci && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node contrast-audit.mjs
//
// It walks every page in both colour schemes, finds each element that paints
// text of its own, works out the colour actually behind it, and reports
// anything under the floor: 4.5:1 for body text, 3:1 for large text (>= 24px,
// or >= 18.66px bold). Identical colour/size combinations are reported once,
// with the pages they appeared on, because a single token usually explains the
// whole list. It exits non-zero if anything failed, so it can gate a release.
//
// Two things it deliberately does not measure:
//
//   - Disabled controls. WCAG exempts inactive components, and Mantine's
//     disabled grey would otherwise dominate the report.
//   - Text on a gradient or image. There is no single background colour to
//     compare against, so those are listed separately and checked by hand —
//     the donate pill is the one case in this app.
//
// Run it against an instance that HAS DATA. The audit can only measure what is
// on screen, so an empty wallet hides every badge, every amount and every row:
// the first run of this script reported clean on a bare instance and found five
// failures the moment the same build was pointed at a seeded one.
//
// The run is self-contained: it sets up the admin and a wallet through the API
// on a fresh instance, or logs in if one already exists.
import { chromium } from "@playwright/test";

const BASE = process.env.CB_BASE_URL ?? "http://localhost:8080";
const PAGES = [
  "/",
  "/accounts",
  "/transactions",
  "/templates",
  "/tags",
  "/assignments",
  "/schedules",
  "/bills",
  "/budget",
  "/goals",
  "/bank-sync",
  "/review",
  "/reports",
  "/vehicles",
  "/categories",
  "/payees",
  "/settings",
];

// Runs in the page. Returns { failures, unmeasured }.
const AUDIT = () => {
  const parse = (c) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (fg, bg) => {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  };
  const ratio = (a, b) => {
    const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
    return (hi + 0.05) / (lo + 0.05);
  };

  // The colour actually painted behind an element: walk up through transparent
  // ancestors, compositing any partly-transparent layer on the way. Returns null
  // as soon as a gradient or image is in the way, because there is then no one
  // colour to compare against.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return null;
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] === 1) break;
      }
    }
    let out = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  };

  const disabled = (el) =>
    !!el.closest(
      "[disabled],[data-disabled],[aria-disabled='true'],fieldset:disabled,[data-mantine-stop-propagation]",
    );

  const failures = [];
  const unmeasured = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(" ");
    if (!own) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (disabled(el)) continue;

    const fg = parse(s.color);
    if (!fg) continue;
    const size = parseFloat(s.fontSize);
    const weight = +s.fontWeight || 400;
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const where = { text: own.slice(0, 48), size, weight, color: s.color, tag: el.tagName.toLowerCase() };

    const bg = bgOf(el);
    if (!bg) {
      unmeasured.push(where);
      continue;
    }
    const c = ratio(over(fg, bg), bg);
    if (c < need) {
      failures.push({
        ...where,
        ratio: +c.toFixed(2),
        need,
        bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`,
        cls: (el.className || "").toString().slice(0, 60),
      });
    }
  }
  return { failures, unmeasured };
};

async function signIn(page) {
  await page.goto(BASE + "/");
  await page.evaluate(async () => {
    const h = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };
    const post = (url, body) =>
      fetch(url, { method: "POST", credentials: "same-origin", headers: h, body: JSON.stringify(body) });
    const { needsSetup } = await (await fetch("/api/v1/setup/status")).json();
    const creds = { username: "admin", password: "supersecret1" };
    if (needsSetup) await post("/api/v1/setup", { ...creds, email: "a@b.com" });
    else await post("/api/v1/auth/login", creds);
    // The first-login tour would sit over every page it is asked to measure.
    await fetch("/api/v1/auth/me", {
      method: "PATCH",
      credentials: "same-origin",
      headers: h,
      body: JSON.stringify({ preferences: { tutorialSeen: true } }),
    });
    const w = await (await fetch("/api/v1/wallets", { credentials: "same-origin" })).json();
    if (!Array.isArray(w) || w.length === 0) await post("/api/v1/wallets", { title: "Audit", baseCurrency: "EUR" });
  });
}

const browser = await chromium.launch();
let failed = 0;
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1320, height: 900 },
      colorScheme: scheme,
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await signIn(page);

    const seen = new Map();
    const skipped = new Set();
    for (const p of PAGES) {
      await page.goto(BASE + p);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      const { failures, unmeasured } = await page.evaluate(AUDIT);
      for (const f of failures) {
        const key = `${f.color}|${f.bg}|${f.size}|${f.weight}`;
        if (!seen.has(key)) seen.set(key, { ...f, pages: new Set() });
        seen.get(key).pages.add(p);
      }
      for (const u of unmeasured) skipped.add(`${u.tag} "${u.text}" (${u.size}px/${u.weight}, ${u.color})`);
    }

    failed += seen.size;
    console.log(`\n=== ${scheme.toUpperCase()} — ${seen.size} failing colour combinations ===`);
    for (const v of [...seen.values()].sort((a, b) => a.ratio - b.ratio)) {
      console.log(
        `${String(v.ratio).padStart(5)} (need ${v.need})  ${v.size}px/${v.weight}  ${v.color} on ${v.bg}  <${v.tag} class="${v.cls}">  "${v.text}"  [${[...v.pages].join(" ")}]`,
      );
    }
    if (skipped.size) {
      console.log(`\n  on a gradient or image, check by hand:`);
      for (const s of skipped) console.log(`    ${s}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failed === 0 ? "\nAA clean in both schemes." : `\n${failed} combinations under the floor.`);
process.exit(failed === 0 ? 0 : 1);
