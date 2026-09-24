// Screen-reader and semantics audit against a running CloudBank, with axe-core.
//
//   1. build + run the binary (or `docker run`) so the app is on a base URL
//   2. cd e2e && npm ci && npx playwright install chromium
//   3. CB_BASE_URL=http://localhost:8080 node axe-audit.mjs
//
// It runs axe's WCAG 2.2 A/AA rules on every page in both colour schemes, and
// then on the surfaces the restyle changed that are not pages at all: the entry
// sheet (a drawer), a confirmation over it, the register's column panel, and the
// dashboard in layout mode. Those are where names, roles and focus order are
// most likely to have gone wrong, and a page-by-page walk never opens them.
//
// Violations are grouped by rule and by the element they point at, with the
// pages and states they appeared in, because one component explains a whole
// list. Exits non-zero if anything is violated.
//
// `color-contrast` is left on even though contrast-audit.mjs measures it: axe
// computes it differently, and a disagreement between the two is worth seeing.
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";

import { BASE, PAGES, settle, signIn } from "./audit-shared.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// The surfaces that only exist after an interaction. Each opens its state from
// a page already loaded, and leaves it open for axe.
const STATES = [
  {
    name: "entry sheet",
    page: "/transactions",
    open: async (page) => {
      await page
        .getByRole("button", { name: "Add transaction" })
        .first()
        .click();
      await page.getByRole("dialog").first().waitFor();
    },
  },
  {
    name: "confirmation over the entry sheet",
    page: "/transactions",
    open: async (page) => {
      // A new entry, not an existing row: a row may be a transfer, whose sheet
      // has no unsaved-edits guard, and then no confirmation ever appears.
      await page
        .getByRole("button", { name: "Add transaction" })
        .first()
        .click();
      const sheet = page.getByRole("dialog").first();
      await sheet.waitFor();
      await page.waitForTimeout(400);
      await sheet
        .getByLabel("Memo", { exact: true })
        .fill("changed for the audit");
      await page.keyboard.press("Escape");
      await page.getByText("Discard your changes?").waitFor();
    },
  },
  {
    // An inline panel under the toolbar, not a menu.
    name: "column panel",
    page: "/transactions",
    open: async (page) => {
      const button = page.getByRole("button", { name: "Columns" });
      await button.click();
      await page
        .locator('button[aria-label="Columns"][aria-pressed="true"]')
        .waitFor();
    },
  },
  {
    name: "dashboard in layout mode",
    page: "/",
    open: async (page) => {
      await page.getByRole("button", { name: "Customise" }).click();
      await page.getByRole("button", { name: "Done" }).waitFor();
    },
  },
];

const browser = await chromium.launch({
  executablePath: process.env.CB_CHROME || undefined,
});
const found = new Map();
const add = (where, violations) => {
  for (const v of violations) {
    for (const node of v.nodes) {
      const target = node.target.join(" ").slice(0, 110);
      const key = `${v.id}|${target}`;
      if (!found.has(key)) {
        found.set(key, {
          rule: v.id,
          impact: v.impact,
          help: v.help,
          target,
          summary: (node.failureSummary ?? "")
            .split("\n")
            .slice(1, 3)
            .join(" / ")
            .trim(),
          html: node.html.slice(0, 140),
          where: new Set(),
        });
      }
      found.get(key).where.add(where);
    }
  }
};

try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1320, height: 900 },
      colorScheme: scheme,
      locale: "en-US",
    });
    const page = await ctx.newPage();
    await signIn(page);

    for (const p of PAGES) {
      await page.goto(BASE + p);
      await settle(page);
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      add(`${scheme} ${p}`, r.violations);
    }
    for (const s of STATES) {
      await page.goto(BASE + s.page);
      await settle(page, 800);
      try {
        await s.open(page);
        await page.waitForTimeout(400);
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        add(`${scheme} [${s.name}]`, r.violations);
      } catch (e) {
        console.log(
          `  could not open "${s.name}" (${scheme}): ${e.message.split("\n")[0]}`,
        );
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const rows = [...found.values()].sort(
  (a, b) =>
    (order[a.impact] ?? 9) - (order[b.impact] ?? 9) ||
    a.rule.localeCompare(b.rule),
);
let lastRule = "";
for (const v of rows) {
  if (v.rule !== lastRule) {
    console.log(`\n=== ${v.rule} (${v.impact}) — ${v.help}`);
    lastRule = v.rule;
  }
  const where = [...v.where];
  const shown =
    where.length > 6
      ? `${where.slice(0, 6).join(", ")} … +${where.length - 6}`
      : where.join(", ");
  console.log(
    `  ${v.target}\n      ${v.summary}\n      ${v.html}\n      [${shown}]`,
  );
}
const rules = new Set(rows.map((r) => r.rule));
console.log(
  rows.length === 0
    ? "\nNo axe violations in either scheme."
    : `\n${rows.length} violating elements across ${rules.size} rules.`,
);
process.exit(rows.length === 0 ? 0 : 1);
