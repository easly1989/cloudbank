// Extracts the style tile's boards as measured data.
//
// The design artefact — "CloudBank restyle — style tile" — is the target the UI
// is built against, and a screenshot is not a specification: you cannot read a
// column width or a font weight off one. This dumps every board's element tree
// with text, position, size, weight, colour and spacing, so the UI can be built
// to those numbers and checked back against them.
//
//   1. export the artefact's boards as standalone HTML into a folder
//   2. serve that folder:  python -m http.server 8123
//   3. node docs/design/extract-spec.mjs http://127.0.0.1:8123
//
// Writes one JSON per board beside this file. Re-run it whenever the artefact
// changes; the diff then says exactly what moved.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://127.0.0.1:8123";

// Board file → the name it is given on the canvas.
const BOARDS = {
  "1-Foundations.html": "foundations",
  "2-Dark.html": "dark",
  "3-Register.html": "register",
  "4-Overview.html": "overview",
  "5-Settings.html": "settings",
  "6-Secondary-pages.html": "secondary-pages",
  "7-Entering-and-deciding.html": "entering-and-deciding",
};

// Runs in the page. Every element that paints something, with what it paints
// and where — the vocabulary the UI has to be built in.
const MEASURE = () => {
  const out = [];
  const walk = (el, depth) => {
    for (const child of el.children) {
      const box = child.getBoundingClientRect();
      // Skip wrappers that occupy nothing, but keep walking through them.
      if (box.width === 0 && box.height === 0) {
        walk(child, depth);
        continue;
      }
      const s = getComputedStyle(child);
      const own = [...child.childNodes]
        .filter((n) => n.nodeType === 3 && n.textContent.trim())
        .map((n) => n.textContent.trim())
        .join(" ");
      out.push({
        depth,
        tag: child.tagName.toLowerCase(),
        text: own,
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
        font: `${s.fontSize}/${s.fontWeight}`,
        mono: /Mono/.test(s.fontFamily),
        color: s.color,
        background: s.backgroundColor === "rgba(0, 0, 0, 0)" ? "" : s.backgroundColor,
        border: s.borderTopWidth === "0px" && s.borderBottomWidth === "0px" ? "" : s.border,
        radius: s.borderRadius === "0px" ? "" : s.borderRadius,
        padding: s.padding === "0px" ? "" : s.padding,
        gap: s.gap === "normal" ? "" : s.gap,
        display: s.display,
        // Grid columns are how a ledger row is laid out; without them the
        // widths in `x` are just numbers with no rule behind them.
        gridTemplateColumns: s.gridTemplateColumns === "none" ? "" : s.gridTemplateColumns,
      });
      walk(child, depth + 1);
    }
  };
  walk(document.body, 0);
  return out;
};

const browser = await chromium.launch();
try {
  for (const [file, name] of Object.entries(BOARDS)) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    await page.goto(`${BASE}/${file}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(600);
    const elements = await page.evaluate(MEASURE);
    const out = resolve(HERE, `${name}.json`);
    writeFileSync(out, JSON.stringify({ board: name, source: file, elements }, null, 1) + "\n");
    console.log(`${name}: ${elements.length} elements`);
    await page.close();
  }
} finally {
  await browser.close();
}
