// CI guard: every locale file must define exactly the same set of keys as the
// reference locale (en). Run via `npm run check:i18n`.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, "..", "src", "i18n", "locales");
const reference = "en";

function keyPaths(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === "object" ? keyPaths(v, path) : [path];
  });
}

const load = (lng) => JSON.parse(readFileSync(join(localesDir, `${lng}.json`), "utf8"));

const refKeys = new Set(keyPaths(load(reference)));
const locales = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

let failed = false;
for (const lng of locales) {
  if (lng === reference) continue;
  const keys = new Set(keyPaths(load(lng)));
  const missing = [...refKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !refKeys.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`locale "${lng}" mismatch vs "${reference}":`);
    if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
    if (extra.length) console.error(`  extra:   ${extra.join(", ")}`);
  }
}

if (failed) {
  process.exit(1);
}
console.log(`i18n OK: ${locales.length} locales share ${refKeys.size} keys.`);
