// Touch-target audit against a running CloudBank.
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npm ci && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node target-size-audit.mjs
//
// It walks every page on a phone — 390x844, touch — and measures every control a
// finger can press. #403 promised touch targets of at least 44px; WCAG 2.2 puts
// the floor at 24px (2.5.8, AA) and 44px at AAA (2.5.5). Both are gates:
//
//   - under 24px with no room around it fails AA, and is always a defect;
//   - under 44px on a touch screen misses the bar this app set itself (#465:
//     under `pointer: coarse` every control grows to 44; the desktop keeps the
//     boards' sizes, which design-size-audit.mjs checks).
//
// What counts as the target is what a finger can actually hit, which is not
// always the element that receives the event. A Mantine checkbox or switch puts
// a small <input> under a clickable <label>, so an input's target is the union of
// itself, its labels and its component root. A control nested in another control
// is not measured on its own: the outer one is what the finger meets.
//
// WCAG's exemptions are applied, not assumed:
//
//   - Spacing (2.5.8): an undersized target passes AA when a 24px circle centred
//     on it touches no other target and no other undersized target's circle.
//   - A link inside a run of text. Its size is set by the sentence around it.
//   - A native control the browser draws (the date input's own picker button).
//
// It also reports any page wider than the phone. That is #403's other promise,
// and it shows up here first: the sidebar is as wide as the page, so on a page
// that overflows every nav link measures wider than the screen.
//
// Findings are grouped by what the control is, not by page, because one
// component explains the whole list: the same row-action icon shows up on nine
// pages and is one fix. Exits non-zero if anything fails AA, anything is under
// 44px, or a page overflows.
import { chromium } from "@playwright/test";

import { BASE, PAGES, settle, signIn } from "./audit-shared.mjs";

const AA = 24;
const BAR = 44;

// Runs in the page.
const MEASURE = () => {
  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=option]",
    "[role=slider]",
    "[role=combobox]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const shown = (el) => {
    if (el.closest("[aria-hidden='true'], [inert]")) return false;
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === "none" || s.visibility === "hidden") return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const disabled = (el) =>
    el.matches(":disabled") ||
    !!el.closest("[aria-disabled='true'], [data-disabled]");

  // A link is inline when it sits in a run of text: its block has more text
  // than the link itself.
  const inlineInText = (el) => {
    if (el.tagName !== "A" || getComputedStyle(el).display !== "inline")
      return false;
    const text = (el.parentElement?.textContent ?? "").trim();
    return text.length > (el.textContent ?? "").trim().length + 8;
  };

  const union = (rects) => {
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  };
  // Only what actually takes the press: the element and the labels that forward
  // to it. Not the component's root — a switch's root can be taller than
  // anything in it a finger can hit.
  const hitBox = (el) => {
    const rects = [el.getBoundingClientRect()];
    if (el.labels)
      for (const l of el.labels)
        if (shown(l)) rects.push(l.getBoundingClientRect());
    return union(rects);
  };

  const nameOf = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el.labels && el.labels[0]?.textContent) ||
      el.getAttribute("placeholder") ||
      el.textContent ||
      ""
    )
      .split(/\s+/)
      .join(" ")
      .trim()
      .slice(0, 40);

  // The component a control belongs to, which is what a fix changes.
  const componentOf = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const c = [...n.classList].find((k) =>
        /^mantine-[A-Z][A-Za-z]+-root$/.test(k),
      );
      if (c) return c.replace(/^mantine-|-root$/g, "");
      const own = [...n.classList].find((k) => k.startsWith("cb-"));
      if (own) return "." + own;
    }
    return el.tagName.toLowerCase();
  };

  // A control inside another control is measured through the outer one only
  // when the outer one is what gets pressed — a link, a button, a label. A row
  // that is focusable for keyboard navigation does not swallow the checkbox and
  // the action icons inside it: those are targets of their own.
  const PRESSABLE = [
    "a[href]",
    "button",
    "label",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=option]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
  ].join(",");
  // A label that wraps its control is the target (the control inside it is
  // skipped as nested). A label that sits beside its control is already folded
  // into the control's hitBox, so it is not measured twice.
  const wrappingLabels = [...document.querySelectorAll("label")].filter(
    (l) => l.control && l.contains(l.control) && shown(l),
  );
  const all = [...document.querySelectorAll(INTERACTIVE)].filter(shown);
  const targets = [];
  for (const el of [...all, ...wrappingLabels]) {
    if (disabled(el) || (el.tagName === "LABEL" && disabled(el.control)))
      continue;
    if (el.parentElement?.closest(PRESSABLE)) continue;
    targets.push({ el, box: hitBox(el) });
  }

  const distToRect = (x, y, r) =>
    Math.hypot(
      Math.max(r.left - x, 0, x - r.right),
      Math.max(r.top - y, 0, y - r.bottom),
    );
  const centre = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
  const under = (t) => Math.min(t.box.width, t.box.height) < 24;
  const spaced = (t) => {
    const [x, y] = centre(t.box);
    for (const o of targets) {
      if (o === t) continue;
      if (distToRect(x, y, o.box) < 12) return false;
      if (under(o)) {
        const [ox, oy] = centre(o.box);
        if (Math.hypot(x - ox, y - oy) < 24) return false;
      }
    }
    return true;
  };

  const out = [];
  for (const t of targets) {
    const { el, box } = t;
    const small = Math.min(box.width, box.height);
    if (small >= 44) continue;
    out.push({
      component: componentOf(el),
      tag:
        el.tagName.toLowerCase() +
        (el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""),
      name: nameOf(el),
      width: Math.round(box.width),
      height: Math.round(box.height),
      inline: inlineInText(el),
      native:
        el.tagName === "INPUT" &&
        ["date", "time", "color", "file"].includes(el.type),
      spaced: small < 24 ? spaced(t) : true,
    });
  }
  return out;
};

const browser = await chromium.launch({
  executablePath: process.env.CB_CHROME || undefined,
});
let failing = 0;
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await signIn(page);
  // The app sizes touch targets under (pointer: coarse); if the emulation did
  // not produce a coarse pointer, this whole report would be measuring the
  // desktop sizes by mistake.
  const coarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  console.log(
    `emulated pointer: ${coarse ? "coarse (touch)" : "FINE — not a phone"}`,
  );

  // Keyed on what the control is, not its size: the same nav link measures
  // differently on a page that overflows, and it is still one control.
  const seen = new Map();
  const exempt = new Map();
  const overflow = [];
  for (const p of PAGES) {
    await page.goto(BASE + p);
    await settle(page);
    const wide = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    if (wide > 1) overflow.push(`${p} (+${wide}px)`);
    for (const f of await page.evaluate(MEASURE)) {
      const key = `${f.component}|${f.tag}|${f.name}`;
      const bucket = f.inline || f.native ? exempt : seen;
      const small = Math.min(f.width, f.height);
      const prev = bucket.get(key);
      if (!prev) bucket.set(key, { ...f, small, pages: new Set([p]) });
      else {
        prev.pages.add(p);
        const spacedAll = prev.spaced && f.spaced;
        if (small < prev.small) Object.assign(prev, f, { small });
        prev.spaced = spacedAll;
      }
    }
  }

  const rows = [...seen.values()].sort((a, b) => a.small - b.small);
  const pagesOf = (v) =>
    v.pages.size >= PAGES.length - 2 ? "every page" : [...v.pages].join(" ");
  const line = (v) =>
    `${String(v.width).padStart(4)} x ${String(v.height).padEnd(4)} ${v.component.padEnd(20)} ${v.tag.padEnd(22)} "${v.name}"  [${pagesOf(v)}]`;

  const aa = rows.filter((v) => v.small < AA && !v.spaced);
  const bar = rows.filter((v) => !(v.small < AA && !v.spaced));
  failing = aa.length + bar.length + overflow.length;

  console.log(
    `\n=== fails WCAG 2.5.8 (AA): under ${AA}px with no room around it — ${aa.length} ===`,
  );
  for (const v of aa) console.log(line(v));
  console.log(`\n=== under the ${BAR}px bar #403 set — ${bar.length} ===`);
  for (const v of bar)
    console.log(line(v) + (v.small < AA ? "   (AA by spacing)" : ""));

  const byComponent = new Map();
  for (const v of rows)
    byComponent.set(v.component, (byComponent.get(v.component) ?? 0) + 1);
  console.log(`\n  by component:`);
  for (const [c, n] of [...byComponent].sort((a, b) => b[1] - a[1]))
    console.log(`    ${String(n).padStart(3)}  ${c}`);

  if (exempt.size) {
    console.log(
      `\n  exempt (inline link in text, or a control the browser draws):`,
    );
    for (const v of exempt.values()) console.log(`    ${line(v)}`);
  }
  console.log(`\n=== pages wider than the phone — ${overflow.length} ===`);
  for (const o of overflow) console.log(`    ${o}`);
  await ctx.close();
} finally {
  await browser.close();
}
console.log(
  failing === 0
    ? "\nEvery target is 44px or more, and every page fits."
    : `\n${failing} failures.`,
);
process.exit(failing === 0 ? 0 : 1);
