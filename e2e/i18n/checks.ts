import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// What the language check (#614) looks for on a page, without reading any text
// it expects: the same checks work for every language, today's and tomorrow's.

const localesDir = join(__dirname, "..", "..", "web", "src", "i18n", "locales");

/** Every language CloudBank speaks: one per translation file. */
export const LANGUAGES = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)));

/** English at three phone and tablet widths; every other language at the narrowest and a desktop. */
export const WIDTHS: Record<string, number[]> = Object.fromEntries(
  LANGUAGES.map((l) => [l, l === "en" ? [320, 390, 768] : [320, 1280]]),
);

/**
 * The top-level groups of the translation keys. A missing key shows as its
 * path, "accounts.addTitle": a dotted word starting with one of these is one,
 * whether or not the key exists in English.
 */
export const NAMESPACES: string[] = Object.keys(
  JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8")),
);

export interface Problem {
  kind: "truncated" | "clipped" | "raw-key" | "placeholder";
  /** The element, as a short selector-like description. */
  where: string;
  text: string;
}

/**
 * Runs in the page. Finds:
 * - text cut off inside a control: a button, a tab, a segmented control, a
 *   badge, a menu item, a table or figure header whose text overflows a box
 *   that hides it. A name truncated on purpose (Mantine's `truncate`, which
 *   sets data-truncate) or marked data-truncate-ok is left alone;
 * - a control cut by the box around it: the second half of a segmented
 *   control that the row has no room for. A box that scrolls is a choice
 *   (a wide table on a phone), so only one that hides counts;
 * - a translation key on screen, which is what i18next shows for a missing one;
 * - a {{placeholder}} left in a sentence.
 */
export function findProblems(namespaces: string[]): Problem[] {
  const problems: Problem[] = [];
  const CONTROLS = [
    "button",
    "[role=button]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=radio]",
    ".mantine-SegmentedControl-label",
    ".mantine-Badge-root",
    "th",
    "[role=columnheader]",
    "[data-figure-label]",
  ].join(",");

  const describe = (el: Element) => {
    const cls =
      [...el.classList].find((c) => c.startsWith("mantine-")) ??
      el.classList[0] ??
      "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    // VisuallyHidden text for screen readers is a 1px box on purpose.
    return (
      r.width > 1 &&
      r.height > 1 &&
      st.visibility !== "hidden" &&
      st.display !== "none"
    );
  };
  const onScreen = (r: DOMRect) => r.right > 0 && r.left < innerWidth;
  /** The nearest box around el that hides what spills out of it sideways. */
  const clipper = (el: Element) => {
    for (
      let a = el.parentElement;
      a && a !== document.body;
      a = a.parentElement
    ) {
      const st = getComputedStyle(a);
      if (["auto", "scroll"].includes(st.overflowX)) return null;
      if (["hidden", "clip"].includes(st.overflowX)) return a;
    }
    return null;
  };
  const hides = (st: CSSStyleDeclaration) =>
    ["hidden", "clip"].includes(st.overflowX) ||
    ["hidden", "clip"].includes(st.overflow) ||
    st.textOverflow === "ellipsis" ||
    st.webkitLineClamp !== "none";

  const seen = new Set<Element>();
  for (const control of document.querySelectorAll(CONTROLS)) {
    if (
      !visible(control) ||
      control.closest("[data-truncate], [data-truncate-ok]")
    )
      continue;
    const r = control.getBoundingClientRect();
    const box = onScreen(r) ? clipper(control) : null;
    if (box) {
      const b = box.getBoundingClientRect();
      const label = (control.textContent ?? "").trim();
      if (label && (r.right > b.right + 1 || r.left < b.left - 1)) {
        problems.push({
          kind: "clipped",
          where: describe(control),
          text: label,
        });
      }
    }
    for (const el of [control, ...control.querySelectorAll("*")]) {
      if (seen.has(el) || !visible(el)) continue;
      seen.add(el);
      if (el.closest("[data-truncate], [data-truncate-ok]")) continue;
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      const st = getComputedStyle(el);
      if (!hides(st)) continue;
      // scrollWidth is rounded, but an ellipsis shows for a fraction of a
      // pixel too: for one, the laid-out text is measured against the box.
      let wide = el.scrollWidth > el.clientWidth + 1;
      // A label that is an icon with its words for screen readers only has
      // nothing on screen to cut.
      const spoken = el.querySelector(".mantine-VisuallyHidden-root");
      if (!wide && st.textOverflow === "ellipsis" && !spoken) {
        const range = document.createRange();
        range.selectNodeContents(el);
        // The box's own width, unrounded, less its borders and padding.
        const px = (v: string) => parseFloat(v) || 0;
        const inner =
          el.getBoundingClientRect().width -
          px(st.borderLeftWidth) -
          px(st.borderRightWidth) -
          px(st.paddingLeft) -
          px(st.paddingRight);
        wide = range.getBoundingClientRect().width > inner + 0.05;
      }
      const tall =
        st.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1;
      if (wide || tall)
        problems.push({ kind: "truncated", where: describe(el), text });
    }
  }

  const body = document.body.innerText;
  const groups = new Set(namespaces);
  for (const m of body.matchAll(
    /\b([a-z][A-Za-z0-9]*)(?:\.[a-z][A-Za-z0-9_]*)+\b/g,
  )) {
    if (groups.has(m[1]))
      problems.push({ kind: "raw-key", where: "page", text: m[0] });
  }
  for (const m of body.matchAll(/\{\{[^}]*\}\}/g)) {
    problems.push({ kind: "placeholder", where: "page", text: m[0] });
  }
  return problems;
}
