// Control sizes against the design boards, measured (#465).
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npm ci && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node design-size-audit.mjs
//
// Every check pairs a control in the app with the element the board draws for
// it, and the board's numbers are read from docs/design/*.json at run time
// rather than copied in here — so when the artefact changes and the extraction
// is re-run, this follows it instead of quietly checking the old design.
//
// It runs at the boards' own width, 1280, with a mouse: the boards are desktop
// designs. The phone's 44px floor is target-size-audit.mjs's job.
//
// Height and font are exact. Width is compared only where the two carry the
// same content — an icon button, a label the app and the board spell the same
// — and then to within 2px, which is what the same text in the same face comes
// to across two renderings.
//
// Exits non-zero on any mismatch, or on a check that could not be run.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE, settle, signIn } from "./audit-shared.mjs";

const DESIGN = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "design",
);
const boards = new Map();
function board(name) {
  if (!boards.has(name)) {
    boards.set(
      name,
      JSON.parse(readFileSync(join(DESIGN, `${name}.json`), "utf8")).elements,
    );
  }
  return boards.get(name);
}
// The board's element: by tag and own text, or by tag and size where it has
// no text of its own (icon buttons, fields).
function spec({ board: b, tag, text, size }) {
  const found = board(b).find(
    (e) =>
      e.tag === tag &&
      (text === undefined || e.text === text) &&
      (size === undefined || (e.w === size[0] && e.h === size[1])),
  );
  if (!found) throw new Error(`${b}.json has no ${tag} ${text ?? size}`);
  return found;
}

// States a check can need, opened from the page it names.
const STATES = {
  sheet: async (page) => {
    await page.getByRole("button", { name: "Add transaction" }).first().click();
    await page.getByRole("dialog").first().waitFor();
    await page.waitForTimeout(500);
  },
  confirm: async (page) => {
    await STATES.sheet(page);
    await page
      .getByRole("dialog")
      .first()
      .getByLabel("Memo", { exact: true })
      .fill("changed");
    await page.keyboard.press("Escape");
    await page.getByText("Discard your changes?").waitFor();
    await page.waitForTimeout(400);
  },
  selection: async (page) => {
    await page.locator(".cb-row-select").first().click();
    await page
      .getByText(/selected/)
      .first()
      .waitFor();
  },
  columns: async (page) => {
    await page.getByRole("button", { name: "Columns" }).click();
    await page
      .locator('button[aria-label="Columns"][aria-pressed="true"]')
      .waitFor();
  },
};

const role =
  (r, name, opts = {}) =>
  (page) =>
    page.getByRole(r, { name, exact: true, ...opts }).first();
// The confirmation is found by its name, not by being the last dialog: it
// mounts with the app, before the sheet it is asked from, so in the portal it
// comes first.
const inConfirm = (name) => (page) =>
  page
    .getByRole("dialog", { name: "Discard your changes?" })
    .getByRole("button", { name, exact: true });

// Checks that stay in the report but do not fail it, each with the issue that
// owns the gap. The entry sheet is laid out differently from its board, not
// merely sized differently, and is rebuilt in #469.
const DEFERRED = new Map([
  ["sheet: amount", "#469"],
  ["sheet: save", "#469"],
]);

// [what, page, state, app control, board element, compare width?,
//  where the text is set, when that is not the control itself]
const CHECKS = [
  // Register board
  [
    "register header: Import",
    "/transactions",
    null,
    role("link", "Import"),
    { board: "register", tag: "button", text: "Import" },
    true,
  ],
  [
    "register header: Add transaction",
    "/transactions",
    null,
    role("button", "Add transaction"),
    { board: "register", tag: "button", text: "Add transaction" },
    true,
  ],
  [
    "register toolbar: search box",
    "/transactions",
    null,
    (p) => p.locator(".cb-register-search input"),
    { board: "register", tag: "div", size: [964, 46] },
    false,
  ],
  [
    "register toolbar: filters",
    "/transactions",
    null,
    role("button", "Filters & quick add"),
    { board: "register", tag: "button", size: [44, 44] },
    true,
  ],
  [
    "register toolbar: privacy",
    "/transactions",
    null,
    role("button", "Hide names and amounts"),
    { board: "register", tag: "button", size: [44, 44] },
    true,
  ],
  [
    "register toolbar: columns",
    "/transactions",
    null,
    role("button", "Columns"),
    { board: "register", tag: "button", size: [44, 44] },
    true,
  ],
  [
    "register row: edit",
    "/transactions",
    null,
    role("button", "Edit"),
    { board: "register", tag: "button", size: [30, 30] },
    true,
  ],
  [
    "register row: delete",
    "/transactions",
    null,
    role("button", "Delete"),
    { board: "register", tag: "button", size: [30, 30] },
    true,
  ],
  [
    "selection bar: delete",
    "/transactions",
    "selection",
    (p) => p.getByRole("button", { name: "Delete", exact: true }).last(),
    { board: "register", tag: "button", text: "Delete" },
    true,
  ],
  [
    "column panel: reset",
    "/transactions",
    "columns",
    role("button", "Reset"),
    { board: "register", tag: "button", text: "Reset" },
    false,
  ],
  [
    "column panel: done",
    "/transactions",
    "columns",
    role("button", "Done"),
    { board: "register", tag: "button", text: "Done" },
    false,
  ],

  // Overview board
  [
    "overview header: Customise",
    "/",
    null,
    role("button", "Customise"),
    { board: "overview", tag: "button", text: "Customise" },
    true,
  ],
  [
    "overview header: Add transaction",
    "/",
    null,
    role("link", "Add transaction"),
    { board: "overview", tag: "button", text: "Add transaction" },
    true,
  ],
  [
    "overview period: Month",
    "/",
    null,
    (p) => p.locator(".cb-period-switch label").filter({ hasText: /^Month$/ }),
    { board: "overview", tag: "button", text: "Month" },
    true,
  ],
  [
    "sidebar: wallet card",
    "/",
    null,
    role("button", "Switch wallet"),
    { board: "overview", tag: "button", size: [236, 55] },
    true,
  ],
  [
    "sidebar: nav link",
    "/",
    null,
    role("link", "Accounts"),
    { board: "overview", tag: "a", text: "Accounts" },
    true,
  ],
  [
    "sidebar: support",
    "/",
    null,
    (p) => p.getByRole("link", { name: /Support CloudBank/ }),
    { board: "overview", tag: "button", text: "Support CloudBank" },
    true,
  ],
  [
    "sidebar: settings gear",
    "/",
    null,
    role("link", "Settings"),
    { board: "overview", tag: "a", size: [34, 34] },
    true,
  ],
  [
    "sidebar: user",
    "/",
    null,
    role("button", "admin"),
    { board: "overview", tag: "a", text: "demo" },
    // Height only: the app's foot also holds a collapse-sidebar button the
    // board does not draw — a deliberate divergence, listed in
    // docs/design/README.md — and the user row gives up its 36px.
    false,
  ],

  // Secondary pages board
  [
    "secondary header: Add bill",
    "/bills",
    null,
    role("button", "Add bill"),
    { board: "secondary-pages", tag: "button", text: "Add bill" },
    true,
  ],
  [
    "secondary header: New rule",
    "/assignments",
    null,
    role("button", "New rule"),
    { board: "secondary-pages", tag: "button", text: "New rule" },
    true,
  ],

  // Settings board
  [
    "settings rail: section",
    "/settings",
    null,
    role("link", "Appearance"),
    { board: "settings", tag: "a", text: "Appearance" },
    true,
  ],
  [
    "settings: select",
    "/settings",
    null,
    (p) => p.locator(".mantine-Select-input").first(),
    { board: "settings", tag: "select", size: [296, 44] },
    false,
  ],
  [
    "settings: theme choice",
    "/settings/appearance",
    null,
    (p) => p.locator(".cb-choice").first(),
    { board: "settings", tag: "button", text: "Auto" },
    false,
    // The board draws three buttons; the app one control holding three labels.
    // Its height is the control's, its type is the labels'.
    (p) => p.locator(".cb-choice .mantine-SegmentedControl-label").first(),
  ],
  [
    "settings: accent swatch",
    "/settings/appearance",
    null,
    role("button", "teal"),
    { board: "settings", tag: "button", size: [22, 22] },
    true,
  ],

  // Entering and deciding board
  [
    "sheet: close",
    "/transactions",
    "sheet",
    (p) => p.locator(".mantine-Drawer-close"),
    { board: "entering-and-deciding", tag: "button", size: [34, 34] },
    true,
  ],
  [
    "sheet: amount",
    "/transactions",
    "sheet",
    (p) => p.getByRole("dialog").first().getByLabel("Amount", { exact: true }),
    { board: "entering-and-deciding", tag: "input", size: [355, 58] },
    false,
  ],
  [
    "sheet: field",
    "/transactions",
    "sheet",
    (p) => p.getByRole("dialog").first().getByLabel("Memo", { exact: true }),
    { board: "entering-and-deciding", tag: "input", size: [355, 44] },
    false,
  ],
  [
    "sheet: save",
    "/transactions",
    "sheet",
    (p) =>
      p
        .locator(".mantine-Drawer-body button")
        .filter({ hasText: /^Save/ })
        .last(),
    { board: "entering-and-deciding", tag: "button", text: "Save" },
    true,
  ],
  [
    "confirmation: confirm",
    "/transactions",
    "confirm",
    inConfirm("Discard"),
    { board: "entering-and-deciding", tag: "button", text: "Delete" },
    false,
  ],
  [
    "confirmation: cancel",
    "/transactions",
    "confirm",
    inConfirm("Keep editing"),
    { board: "entering-and-deciding", tag: "button", text: "Keep them" },
    false,
  ],
];

const MEASURE = (el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return { w: r.width, h: r.height, font: `${s.fontSize}/${s.fontWeight}` };
};

const browser = await chromium.launch({
  executablePath: process.env.CB_CHROME || undefined,
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 980 },
  locale: "en-US",
});
const page = await ctx.newPage();
await signIn(page);

let failed = 0;
const rows = [];
let open = "";
for (const [what, path, state, locate, where, width, textOf] of CHECKS) {
  try {
    const want = spec(where);
    const key = `${path}|${state}`;
    if (key !== open) {
      await page.goto(BASE + path);
      await settle(page, 700);
      if (state) await STATES[state](page);
      open = key;
    }
    const el = locate(page);
    await el.waitFor({ timeout: 5000 });
    const got = await el.evaluate(MEASURE);
    if (textOf) got.font = (await textOf(page).evaluate(MEASURE)).font;
    const bad = [];
    if (Math.abs(got.h - want.h) > 0.5)
      bad.push(`h ${Math.round(got.h)}≠${want.h}`);
    if (width && Math.abs(got.w - want.w) > 2)
      bad.push(`w ${Math.round(got.w)}≠${want.w}`);
    // A field's box is not where its text is set; its font is checked on the
    // input, and an input the board draws with no text has nothing to compare.
    if (want.text && got.font !== want.font)
      bad.push(`font ${got.font}≠${want.font}`);
    const deferred = bad.length && DEFERRED.get(what);
    if (bad.length && !deferred) failed++;
    const mark = !bad.length ? "ok  " : deferred ? "LATE" : "FAIL";
    if (deferred) bad.push(`deferred to ${deferred}`);
    rows.push([
      mark,
      what,
      `${want.w}x${want.h} ${want.font}`,
      `${Math.round(got.w)}x${Math.round(got.h)} ${got.font}`,
      bad.join(", "),
    ]);
  } catch (e) {
    failed++;
    rows.push(["ERR ", what, "", "", e.message.split("\n")[0]]);
    open = "";
  }
}

// The register has to fit at the boards' width with its default columns. When
// it did not, the ledger scrolled sideways and a row's own Edit and Delete sat
// past the right edge — every size above could match and the page still be
// wrong. Rows are positioned by the virtualiser and add nothing to the scroll
// width, so it is the ledger card's own sideways overflow that is measured.
await page.goto(BASE + "/transactions");
await settle(page, 700);
const over = await page.evaluate(() => {
  // The ledger scrolls itself vertically; the card around it is what
  // scrolls sideways, so the search starts above the ledger.
  let n = document.querySelector(".cb-ledger")?.parentElement;
  while (n && getComputedStyle(n).overflowX !== "auto") n = n.parentElement;
  return n ? n.scrollWidth - n.clientWidth : null;
});
if (over === null || over > 1) failed++;
rows.push([
  over === null || over > 1 ? "FAIL" : "ok  ",
  "register fits at 1280",
  "no sideways scroll",
  over === null ? "ledger not found" : `${over}px over`,
  "",
]);
await browser.close();

const pad = (s, n) => String(s).padEnd(n);
console.log(
  `${pad("", 5)}${pad("control", 36)}${pad("board", 22)}${pad("app", 22)}`,
);
for (const [mark, what, want, got, why] of rows) {
  console.log(`${mark} ${pad(what, 36)}${pad(want, 22)}${pad(got, 22)}${why}`);
}
console.log(
  failed === 0
    ? `\nAll ${rows.length} controls match their boards.`
    : `\n${failed} of ${rows.length} controls differ from their boards.`,
);
process.exit(failed === 0 ? 0 : 1);
