// Reduced-motion audit against a running CloudBank.
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npm ci && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node motion-audit.mjs
//
// For each interaction that moves something — opening the entry sheet, a
// confirmation, a menu, a dropdown, collapsing a sidebar group, putting the
// dashboard into layout mode, hovering a button — it records every animation
// the browser actually runs, from `document.getAnimations()`. That covers CSS
// transitions, CSS animations and Web Animations alike, so nothing depends on
// knowing how a given component chose to animate.
//
// It runs each interaction twice. With `prefers-reduced-motion: reduce`, which
// is the audit. And without it, as a control: an interaction that shows no
// animation in either run is one this audit cannot see, not one that is clean,
// and it says so rather than reporting it as a pass.
//
// Under reduce, anything that MOVES fails — transform, position, size. A fade
// (opacity, colour, shadow) is reported but not failed: WCAG 2.3.3 is about
// motion, and a fade does not move anything across the screen.
//
// Exits non-zero if anything moves under reduce.
import { chromium } from "@playwright/test";

import { BASE, settle, signIn } from "./audit-shared.mjs";

const MOTION =
  /^(transform|translate|scale|rotate|top|left|right|bottom|inset|width|height|max-height|margin)/;

const INTERACTIONS = [
  {
    name: "open the entry sheet",
    page: "/transactions",
    act: (page) =>
      page.getByRole("button", { name: "Add transaction" }).first().click(),
  },
  {
    name: "open a confirmation",
    page: "/transactions",
    act: async (page) => {
      // A new entry: an existing row may be a transfer, whose sheet has no
      // unsaved-edits guard, and then no confirmation ever appears.
      await page
        .getByRole("button", { name: "Add transaction" })
        .first()
        .click();
      const sheet = page.getByRole("dialog").first();
      await sheet.waitFor();
      await page.waitForTimeout(600); // let the sheet itself finish opening
      await sheet
        .getByLabel("Memo", { exact: true })
        .fill("changed for the audit");
      await page.evaluate(() => (window.__cbMark = true));
      await page.keyboard.press("Escape");
    },
    // Only what starts after the sheet has settled belongs to the confirmation.
    afterMark: true,
  },
  {
    name: "open a menu",
    page: "/transactions",
    act: (page) => page.getByRole("button", { name: "More actions" }).click(),
  },
  {
    name: "open a select dropdown",
    page: "/",
    // Any Mantine Select will do; the dashboard has two.
    act: (page) => page.locator('input[role="combobox"]').first().click(),
  },
  {
    name: "collapse a sidebar group",
    page: "/",
    act: (page) =>
      page.getByRole("button", { name: "Planning", exact: true }).click(),
  },
  {
    name: "dashboard layout mode",
    page: "/",
    act: (page) => page.getByRole("button", { name: "Customise" }).click(),
  },
  {
    name: "hover a button",
    page: "/accounts",
    act: (page) => page.getByRole("button", { name: "Add account" }).hover(),
  },
  {
    name: "switch a tab",
    page: "/reports",
    act: (page) => page.getByRole("tab", { name: "Trend" }).click(),
  },
];

// Installs a sampler that records every animation it sees, every frame, until
// told to stop. Sampling rather than one look, because a 150ms transition that
// starts a frame after the click is over before a single check would run.
const START = () => {
  window.__cbSeen = new Map();
  window.__cbMark = window.__cbMark ?? false;
  const describe = (a) => {
    const t = a.effect?.target;
    const cls =
      t && t.classList
        ? [...t.classList].find(
            (c) => c.startsWith("mantine-") || c.startsWith("cb-"),
          )
        : "";
    let props = [];
    if (a.transitionProperty) props = [a.transitionProperty];
    else if (a.animationName) {
      const kf = a.effect?.getKeyframes?.() ?? [];
      props = [...new Set(kf.flatMap((k) => Object.keys(k)))].filter(
        (p) => !["offset", "easing", "composite", "computedOffset"].includes(p),
      );
      props = props.length ? props : [`@${a.animationName}`];
    } else {
      const kf = a.effect?.getKeyframes?.() ?? [];
      props = [...new Set(kf.flatMap((k) => Object.keys(k)))].filter(
        (p) => !["offset", "easing", "composite", "computedOffset"].includes(p),
      );
    }
    const dur = a.effect?.getComputedTiming?.().duration ?? 0;
    return {
      target: `${t?.tagName?.toLowerCase() ?? "?"}${cls ? "." + cls : ""}`,
      props,
      dur,
    };
  };
  const tick = () => {
    for (const a of document.getAnimations()) {
      if (a.playState !== "running") continue;
      if (window.__cbOnlyAfterMark && !window.__cbMark) continue;
      const d = describe(a);
      if (!d.dur || d.dur < 1) continue;
      for (const p of d.props)
        window.__cbSeen.set(`${d.target}|${p}`, { ...d, prop: p });
    }
    window.__cbRaf = requestAnimationFrame(tick);
  };
  window.__cbRaf = requestAnimationFrame(tick);
};
const STOP = () => {
  cancelAnimationFrame(window.__cbRaf);
  return [...window.__cbSeen.values()];
};

async function run(reduce) {
  const browser = await chromium.launch({
    executablePath: process.env.CB_CHROME || undefined,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1320, height: 900 },
    locale: "en-US",
    reducedMotion: reduce ? "reduce" : "no-preference",
  });
  const page = await ctx.newPage();
  await signIn(page);
  const out = new Map();
  for (const i of INTERACTIONS) {
    await page.goto(BASE + i.page);
    await settle(page, 700);
    try {
      await page.evaluate((only) => {
        window.__cbMark = false;
        window.__cbOnlyAfterMark = only;
      }, !!i.afterMark);
      await page.evaluate(START);
      await i.act(page);
      await page.waitForTimeout(700);
      out.set(i.name, await page.evaluate(STOP));
    } catch (e) {
      out.set(i.name, { error: e.message.split("\n")[0] });
    }
  }
  await browser.close();
  return out;
}

const reduced = await run(true);
const control = await run(false);

let failing = 0;
for (const i of INTERACTIONS) {
  const r = reduced.get(i.name);
  const c = control.get(i.name);
  console.log(`\n=== ${i.name}  (${i.page})`);
  if (r?.error || c?.error) {
    console.log(`  could not run: ${r?.error ?? c?.error}`);
    continue;
  }
  if (r.length === 0 && c.length === 0) {
    console.log(
      "  nothing animates even without reduce — this audit cannot see it; check by hand",
    );
    continue;
  }
  const moving = r.filter((a) => MOTION.test(a.prop));
  const fading = r.filter((a) => !MOTION.test(a.prop));
  failing += moving.length;
  console.log(
    `  without reduce: ${c.length} animated properties   with reduce: ${moving.length} moving, ${fading.length} fading`,
  );
  for (const a of moving)
    console.log(`    MOVES  ${a.target}  ${a.prop}  ${Math.round(a.dur)}ms`);
  for (const a of fading)
    console.log(`    fades  ${a.target}  ${a.prop}  ${Math.round(a.dur)}ms`);
}
console.log(
  failing === 0
    ? "\nNothing moves when the reader has asked for less movement."
    : `\n${failing} moving animations still run under prefers-reduced-motion.`,
);
process.exit(failing === 0 ? 0 : 1);
