// CI guard for the translations. Run via `npm run check:i18n`. Five checks
// fail the build:
//
//   1. Parity: every locale defines exactly the keys the reference (en) does.
//   2. Plurals (#447): a key that has one plural form has every form its
//      language needs. Parity cannot see this — two locales that both lack
//      `_one` agree perfectly — and the reader with one item gets the raw key.
//   3. References (#458): every key the source names exists. Parity cannot see
//      this either — `bulk.clear` shipped to the screen while both locales
//      agreed that neither had it.
//   4. Placeholders (#610): a translation has the same {{x}} and <1> tags as
//      the English it translates. A missing {{count}} shows the wrong number
//      or none; an extra one shows "{{count}}" itself.
//   5. Empty values (#610): an empty string renders nothing, silently. Nor
//      may a value hold a control character, which renders as a box.
//
// And one prints a warning without failing: values identical to the English,
// which are probably not translated, unless listed as words a language keeps.
// The glossary has its own warning-only check, scripts/check-glossary.mjs.
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
// Intl's full list. Sampled rather than written down, so a language added
// later brings its own rules with it, and sampled past a thousand, where
// Italian, Spanish, French and Portuguese select `many` for round millions.
function neededForms(lng) {
  const rules = new Intl.PluralRules(lng);
  const forms = new Set();
  for (let n = 0; n <= 1000; n++) {
    forms.add(rules.select(n));
    forms.add(rules.select(n + 0.5));
  }
  for (let n = 1e4; n <= 1e9; n *= 10) {
    forms.add(rules.select(n));
    forms.add(rules.select(2 * n));
  }
  return forms;
}

// A missing `_many` is filled from `_other` when the language loads
// (withMany in src/i18n/index.ts, #602), so `_other` covers it here too.
const covered = (form, forms) => forms.has(form) || (form === "many" && forms.has("other"));

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
    const missing = [...needed].filter((f) => !covered(f, forms));
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

// --- 4. Placeholders, 5. empty values ------------------------------------------

function flatValues(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? flatValues(v, path) : [[path, v]];
  });
}
const values = new Map(locales.map((lng) => [lng, new Map(flatValues(load(lng)))]));
const refValues = values.get(reference);

// The {{name}} placeholders (a format after a comma is ignored) and the <1>
// tags of <Trans>, sorted, so their order may change with the language.
const placeholders = (s) =>
  [
    ...[...s.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/g)].map((m) => `{{${m[1]}}}`),
    ...[...s.matchAll(/<\/?[A-Za-z0-9]+\s*\/?>/g)].map((m) => m[0].replace(/\s/g, "")),
  ].sort();

// What a key translates: the same key in English, or, for a plural form
// English does not have (`_many`, `_few`), its `_other`.
function englishOf(key) {
  if (refValues.has(key)) return refValues.get(key);
  const m = key.match(PLURAL);
  return m ? refValues.get(`${key.slice(0, -m[0].length)}_other`) : undefined;
}

for (const lng of locales) {
  for (const [key, value] of values.get(lng)) {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${lng}: "${key}" is empty`);
      continue;
    }
    // A control character draws an empty box (a mangled escape, #616).
    if (/[\u0000-\u001f\u007f]/.test(value))
      errors.push(`${lng}: "${key}" has a control character`);
    if (lng === reference) continue;
    const en = englishOf(key);
    if (en === undefined) continue;
    const want = placeholders(en).join(" ");
    const got = placeholders(value).join(" ");
    // English may write "1" in its `_one`; French and Portuguese select `_one`
    // for 0 as well, so theirs needs the {{count}}.
    const addsCount =
      PLURAL.test(key) &&
      got === [...placeholders(en), "{{count}}"].sort().join(" ") &&
      !want.includes("{{count}}");
    if (want !== got && !addsCount)
      errors.push(
        `${lng}: "${key}" has ${got || "no placeholders"}, English has ${want || "none"}`,
      );
  }
}

// --- Warning: identical to English ------------------------------------------

// Words a translation rightly leaves as they are: names, codes, units, and
// words a language has borrowed. Everywhere first, then per language.
const SAME_EVERYWHERE = new Set([
  "CloudBank",
  "SimpleFIN",
  "Enable Banking (EU)",
  "Application ID",
  "Client ID",
  "Client secret",
  "Item ID",
  "QIF",
  "OFX/QFX",
  "CAMT.053 (ISO 20022)",
  "OK",
  "AI",
  "Push",
  "Webhook",
  "Matrix",
  "Telegram",
  "Discord",
  "Slack",
  "ntfy",
  "Gotify",
  "URL",
  "Token",
  "Email",
  "km",
  "L/100km",
  "L",
  "S",
  "M",
  "sk-…",
]);
const SAME_IN = {
  it: [
    "In app",
    "Server",
    "Topic",
    "Email",
    "Homeserver",
    "Tag",
    "Budget",
    "Password",
    "Report",
    "Info",
    "Auto",
    "auto",
    "Admin",
    "Demo",
    "Feb",
    "Mar",
    "Apr",
    "Nov",
    "Per 100 km",
    "Provider",
    "info “{{info}}”",
    "per {{code}}",
    "{{transactions}} in {{groups}}",
    "{{kind}}, in {{group}}",
    "{{kind}} · {{spent}} in {{period}}",
  ],
  // German borrows these as they are, and capitalizes them as nouns.
  de: [
    "Homeserver",
    "Server",
    "Links",
    "Tag",
    "Tags",
    "Budget",
    "Budgets",
    "Import",
    "Status",
    "Plan",
    "Text",
    "Info",
    "Optional",
    "Name",
    "Bank",
    "Administrator",
    "Administration",
    "Admin",
    "Symbol",
    "Port",
    "Navigation",
    "Demo",
    "Bank / CSV / QIF / OFX",
    "Q{{n}} {{year}}",
    "H{{n}} {{year}}",
    "Detail: {{text}}",
    "{{transactions}} in {{groups}}",
    "{{kind}}, in {{group}}",
  ],
  // French spells these the same as English.
  fr: [
    "Guide",
    "Budget",
    "Budgets",
    "Date",
    "Info",
    "Net",
    "Mode",
    "Auto",
    "auto",
    "Note",
    "Notes",
    "Distance",
    "Total",
    "Notifications",
    "Admin",
    "Administration",
    "Actions",
    "Type",
    "Index",
    "Source",
    "Section",
    "Navigation",
    "Expression",
    "Port",
    "{{host}} · port {{port}} · {{security}}",
    "Point .",
    "Apostrophe '",
    "version {{version}}",
  ],
  // Spanish spells these the same as English.
  es: [
    "Info",
    "Auto",
    "auto",
    "Manual",
    "Experimental",
    "Error",
    "Total",
    "Subtotal",
    "Admin",
    "Decimal",
    "General",
    "Demo",
  ],
  // Brazilian Portuguese spells these the same as English, and keeps Tag (#596).
  "pt-BR": [
    "Links",
    "Tag",
    "Tags",
    "Status",
    "Info",
    "info “{{info}}”",
    "auto",
    "Manual",
    "Experimental",
    "Total",
    "Subtotal",
    "Admin",
    "Decimal",
    "Demo",
  ],
};

const untranslated = [];
for (const lng of locales) {
  if (lng === reference) continue;
  const keep = new Set(SAME_IN[lng] ?? []);
  for (const [key, value] of values.get(lng)) {
    if (value !== englishOf(key) || SAME_EVERYWHERE.has(value) || keep.has(value)) continue;
    // Nothing but placeholders and punctuation: there is nothing to translate.
    if (!/\p{L}/u.test(value.replace(/\{\{[^}]*\}\}/g, ""))) continue;
    untranslated.push(`${lng}: "${key}" is the English "${value}"`);
  }
}

// ---------------------------------------------------------------------------

if (untranslated.length) {
  console.warn(`Warning: ${untranslated.length} values match the English, probably not translated`);
  console.warn("(if a language rightly keeps one, add it to SAME_IN in scripts/check-i18n.mjs):");
  for (const w of untranslated) console.warn(`  ${w}`);
}

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(
  `i18n OK: ${locales.length} locales share ${refKeys.size} keys; ` +
    `${pluralRoots} plurals complete; placeholders match, no value is empty; ` +
    `${refs.length} key references and ${templates} built keys resolve.`,
);
