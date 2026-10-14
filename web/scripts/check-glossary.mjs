// Warns when a translation drifts from the glossary (#610). Run via
// `npm run check:glossary`; it never fails the build.
//
// For each term in docs/i18n/glossary.md, every English value that uses the
// term should use the language's chosen word: "transfer" is "giroconto" in
// Italian, not "trasferimento". The match is loose on purpose (a stem, so
// "transazioni" counts for "transazione"), and a sentence that uses the
// English word in another sense (a user "account", a "bank transfer") is
// listed in EXCEPTIONS with the term it rightly leaves out.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, "..", "src", "i18n", "locales");
const glossary = join(here, "..", "..", "docs", "i18n", "glossary.md");

// Rows the check cannot read as one term per cell: the page name, which
// shares its word with "schedule", and the two balances, whose "today" is
// everywhere in the app as a plain word.
const SKIP = new Set(["Schedules (the page)", "today / future balance"]);

// Per language, per key: the glossary terms that key rightly does without.
const EXCEPTIONS = {
  it: {
    // A sign-in account, or one at another service, not a CloudBank account.
    "banksync.connectHint": ["account"],
    "twofa.hint": ["account"],
    "setup.subtitle": ["account"],
    "setup.submit": ["account"],
    "setup.ssoReserved": ["account"],
    "demo.loginBody": ["account"],
    "demo.noticeYours": ["account"],
    // "Schedule" as the repetition settings, not a schedule.
    "schedules.transferNote": ["schedule"],
    // The verbs, not the statuses.
    "transactions.savedNew": ["cleared"],
    "tours.schedules.needs.body": ["reconciled"],
    "accessCodes.shownOnce": ["void"],
    // A bank transfer to someone else is a "bonifico", not a giroconto.
    "templates.emptyHint": ["transfer"],
    "paymentModes.4": ["transfer"],
  },
  de: {
    // The plural, Haushaltsbücher, changes the stem's vowel.
    "tour.wallet.title": ["wallet"],
    "backup.hotHint": ["wallet"],
    // "Register" as the verb: erfassen an occurrence, registrieren an app.
    "schedules.state.auto": ["register"],
    "schedules.meta.auto": ["register"],
    "schedules.toRegister": ["register"],
    "schedules.register": ["register"],
    "schedules.sheet.auto": ["register"],
    "schedules.sheet.notNext": ["register"],
    "schedules.form.autoPostHint": ["register"],
    "banksync.eb.configHint": ["register"],
    // The page is Wiederkehrend, and its list view is the Liste.
    "nav.schedules": ["schedule"],
    "schedules.title": ["schedule"],
    "schedules.view.list": ["schedule"],
    "tours.schedules.views.title": ["schedule"],
    // "Schedule" as the repetition settings, not a schedule.
    "schedules.transferNote": ["schedule"],
    "templates.col.schedule": ["schedule"],
    // The verbs, not the statuses.
    "transactions.savedNew": ["cleared"],
    "accessCodes.shownOnce": ["void"],
    // A bank transfer to someone else is an Überweisung, not an Umbuchung.
    "paymentModes.4": ["transfer"],
  },
  fr: {
    // "Register" as the verb: saisir an occurrence, enregistrer an app.
    "schedules.state.auto": ["register"],
    "schedules.meta.auto": ["register"],
    "schedules.toRegister": ["register"],
    "schedules.register": ["register"],
    "schedules.sheet.auto": ["register"],
    "schedules.sheet.notNext": ["register"],
    "schedules.form.autoPostHint": ["register"],
    "banksync.eb.configHint": ["register"],
    // The page is the Échéancier, and its list view is the Liste.
    "nav.schedules": ["schedule"],
    "schedules.title": ["schedule"],
    "schedules.view.list": ["schedule"],
    "tour.nav.body": ["schedule"],
    "tours.schedules.offer": ["schedule"],
    // "Schedule" as the repetition settings, not a schedule.
    "schedules.transferNote": ["schedule"],
    "templates.col.schedule": ["schedule"],
    // The verb, not the status.
    "transactions.savedNew": ["cleared"],
  },
};

function flatValues(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? flatValues(v, path) : [[path, v]];
  });
}
const load = (lng) =>
  new Map(flatValues(JSON.parse(readFileSync(join(localesDir, `${lng}.json`), "utf8"))));

// The terms table: one row per term, one column per language.
const md = readFileSync(glossary, "utf8");
const rows = md
  .slice(md.indexOf("## Terms"))
  .split("\n")
  .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
  .map((l) =>
    l
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim()),
  );
const head = rows.shift();

// "transazione" → "transazion", so "transazioni" matches; short words stay whole.
const stem = (w) => (w.length >= 5 ? w.replace(/[aeiouàáâãèéêìíòóôõùú]+$/i, "") : w);
const PLACEHOLDER = /\{\{[^}]*\}\}/g;

const en = load("en");
const locales = readdirSync(localesDir)
  .map((f) => f.replace(/\.json$/, ""))
  .filter((lng) => lng !== "en" && head.includes(lng));

let total = 0;
for (const lng of locales) {
  const col = head.indexOf(lng);
  const values = load(lng);
  const except = EXCEPTIONS[lng] ?? {};
  const warnings = [];
  for (const row of rows) {
    if (SKIP.has(row[0])) continue;
    const terms = row[0].split(" / ");
    const words = row[col].split(" / ");
    if (terms.length !== words.length) continue;
    terms.forEach((term, i) => {
      const uses = new RegExp(`\\b${term}s?\\b`, "i");
      const stems = words[i].toLowerCase().split(/\s+/).map(stem);
      for (const [key, english] of en) {
        if (!uses.test(english.replace(PLACEHOLDER, ""))) continue;
        if (except[key]?.includes(term)) continue;
        // A soft hyphen (Zahlungs­partner) only shows where the word breaks.
        const value = (values.get(key) ?? "").replace(/­/g, "").toLowerCase();
        if (!stems.every((s) => value.includes(s)))
          warnings.push(
            `  ${lng}: "${key}" says ${term} without "${words[i]}": ${values.get(key)}`,
          );
      }
    });
  }
  total += warnings.length;
  if (warnings.length) {
    console.warn(`Glossary: ${warnings.length} ${lng} values may not use the glossary's word`);
    console.warn("(if one uses the English word in another sense, add it to EXCEPTIONS):");
    for (const w of warnings) console.warn(w);
  }
}
if (!total) console.log(`Glossary OK: ${locales.length} translations use its words.`);
