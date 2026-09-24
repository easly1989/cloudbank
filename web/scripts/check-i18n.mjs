// CI guard for the translations. Run via `npm run check:i18n`. Three checks:
//
//   1. Parity: every locale defines exactly the keys the reference (en) does.
//   2. Plurals (#447): a key that has one plural form has every form its
//      language needs. Parity cannot see this — two locales that both lack
//      `_one` agree perfectly — and the reader with one item gets the raw key.
//   3. References (#458): every key the source names exists. Parity cannot see
//      this either — `bulk.clear` shipped to the screen while both locales
//      agreed that neither had it.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const localesDir = join(root, "src", "i18n", "locales");
const srcDir = join(root, "src");
const reference = "en";

function keyPaths(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? keyPaths(v, path) : [path];
  });
}

const load = (lng) => JSON.parse(readFileSync(join(localesDir, `${lng}.json`), "utf8"));

const locales = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const keysOf = new Map(locales.map((lng) => [lng, new Set(keyPaths(load(lng)))]));
const refKeys = keysOf.get(reference);

const errors = [];

// --- 1. Parity -------------------------------------------------------------

for (const lng of locales) {
  if (lng === reference) continue;
  const keys = keysOf.get(lng);
  const missing = [...refKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !refKeys.has(k));
  if (missing.length) errors.push(`${lng}: missing vs ${reference}: ${missing.join(", ")}`);
  if (extra.length) errors.push(`${lng}: not in ${reference}: ${extra.join(", ")}`);
}

// --- 2. Plurals ------------------------------------------------------------

const PLURAL = /_(zero|one|two|few|many|other)$/;

// The forms a language needs are the ones a count can actually select — not
// Intl's full list. Italian declares `many`, but only for compact notation
// ("1 Mln"); no plain number ever selects it, so i18next never asks for
// `_many` and demanding it here would be wrong. Sampled rather than written
// down, so a language added later brings its own rules with it.
function neededForms(lng) {
  const rules = new Intl.PluralRules(lng);
  const forms = new Set();
  for (let n = 0; n <= 1000; n++) {
    forms.add(rules.select(n));
    forms.add(rules.select(n + 0.5));
  }
  return forms;
}

let pluralRoots = 0;
for (const lng of locales) {
  const needed = neededForms(lng);
  const roots = new Map();
  for (const key of keysOf.get(lng)) {
    const m = key.match(PLURAL);
    if (!m) continue;
    const root = key.slice(0, -m[0].length);
    if (!roots.has(root)) roots.set(root, new Set());
    roots.get(root).add(m[1]);
  }
  if (lng === reference) pluralRoots = roots.size;
  for (const [root, forms] of roots) {
    const missing = [...needed].filter((f) => !forms.has(f));
    if (missing.length)
      errors.push(`${lng}: plural "${root}" lacks ${missing.map((f) => `_${f}`).join(", ")}`);
  }
}

// --- 3. References ---------------------------------------------------------

// A key resolves if it exists, or if it is a plural root: `t("x", { count })`
// reads `x_one` / `x_other`.
const pluralRootSet = new Set([...refKeys].map((k) => k.replace(PLURAL, "")));
const resolves = (key) => refKeys.has(key) || pluralRootSet.has(key);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [p] : [];
  });
}

// Three ways a key reaches t():
//
//   - written into the call, `t("a.b")` — the bulk of them;
//   - built in the call, `t(`attention.${k}Action`)` — checked as a pattern
//     that at least one key must match, which catches a misspelt prefix or
//     suffix though not a wrong value of `k`;
//   - held somewhere else and passed in, `t(item.labelKey)` — the call cannot
//     be read, but the string was written down somewhere. So every string
//     literal in the source that is shaped like a key and starts with one of
//     the locale's namespaces is checked as a key, wherever it sits.
const namespaces = new Set([...refKeys].map((k) => k.split(".")[0]));
const KEY_SHAPE = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/;
const CALL_LITERAL = /\bt\(\s*(["'])((?:(?!\1)[^\\\n])+)\1/g;
const CALL_TEMPLATE = /\bt\(\s*`([^`]*)`/g;
const STRING_LITERAL = /(["'])((?:(?!\1)[^\\\n])+)\1/g;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const refs = [];
let templates = 0;
for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, "utf8");
  const where = (index) =>
    `${relative(root, file).replaceAll("\\", "/")}:${text.slice(0, index).split("\n").length}`;
  const seen = new Set();
  for (const m of text.matchAll(CALL_LITERAL)) {
    seen.add(m.index + m[0].indexOf(m[1]));
    refs.push({ key: m[2], at: where(m.index) });
  }
  for (const m of text.matchAll(CALL_TEMPLATE)) {
    if (!m[1].includes("${")) {
      refs.push({ key: m[1], at: where(m.index) });
      continue;
    }
    templates++;
    const pattern = new RegExp(
      `^${m[1]
        .split(/\$\{[^}]*\}/)
        .map(escape)
        .join(".+")}$`,
    );
    if (![...refKeys].some((k) => pattern.test(k.replace(PLURAL, "")))) {
      errors.push(`${where(m.index)}: no key matches t(\`${m[1]}\`)`);
    }
  }
  for (const m of text.matchAll(STRING_LITERAL)) {
    if (seen.has(m.index)) continue;
    const s = m[2];
    if (KEY_SHAPE.test(s) && namespaces.has(s.split(".")[0]))
      refs.push({ key: s, at: where(m.index) });
  }
}
for (const { key, at } of refs) {
  if (!resolves(key)) errors.push(`${at}: "${key}" is not a key in ${reference}.json`);
}

// ---------------------------------------------------------------------------

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(
  `i18n OK: ${locales.length} locales share ${refKeys.size} keys; ` +
    `${pluralRoots} plurals complete; ${refs.length} key references and ${templates} built keys resolve.`,
);
