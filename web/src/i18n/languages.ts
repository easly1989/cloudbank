/**
 * The languages CloudBank speaks, one row each: the code users.locale stores
 * and the translation file is named after, the name in the language itself,
 * whether it is still a beta translation, and the first day of its week.
 *
 * The server keeps the same codes in internal/locale; a test on each side
 * checks its list against the files in ./locales, so a language cannot be
 * half added.
 */
export interface Language {
  code: string;
  /** In the language itself, so a reader finds theirs whatever is showing. */
  name: string;
  /** A first translation, not yet read by a native speaker in the app. */
  beta: boolean;
  /** 0 = Sunday, 1 = Monday: the first column of calendars. */
  weekStart: 0 | 1;
  /**
   * A beta language's invitation to correct it, in the language itself and
   * saying that it opens GitHub: the reader picking German reads German,
   * whatever the app is showing (#604). Every beta row has one.
   */
  correction?: string;
}

export const languages = [
  { code: "en", name: "English", beta: false, weekStart: 1 },
  { code: "it", name: "Italiano", beta: false, weekStart: 1 },
  {
    code: "de",
    name: "Deutsch",
    beta: true,
    weekStart: 1,
    correction: "Korrektur auf GitHub vorschlagen",
  },
] as const satisfies readonly Language[];

export type LanguageCode = (typeof languages)[number]["code"];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

/**
 * The order a selector shows them in: the complete languages as listed, then
 * the beta ones by their own name (#595).
 */
export function orderedLanguages(list: readonly Language[] = languages): Language[] {
  const byName = (a: Language, b: Language) => a.name.localeCompare(b.name);
  return [...list.filter((l) => !l.beta), ...list.filter((l) => l.beta).sort(byName)];
}

/**
 * The issue form for proposing a correction, with the language chosen and the
 * title started (.github/ISSUE_TEMPLATE/translation.yml, #604).
 */
export function correctionUrl(code: string): string {
  const q = { template: "translation.yml", language: code, title: `[${code}] ` };
  const query = Object.entries(q)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `https://github.com/easly1989/cloudbank/issues/new?${query}`;
}

// A whole language read as the one variant CloudBank speaks: pt-PT, pt-AO and
// plain pt all get Brazilian Portuguese (the server's internal/locale does the same).
const families: Record<string, string> = { pt: "pt-BR" };

/**
 * Turns a tag (it-CH, EN, pt_PT) into a code of `list`, or undefined when
 * CloudBank does not speak the language. The exact code wins, then the
 * language without its region.
 */
export function normalizeLanguage(
  tag: string | null | undefined,
  list: readonly Pick<Language, "code">[] = languages,
): string | undefined {
  const clean = (tag ?? "").trim().replace(/_/g, "-");
  if (!clean) return undefined;
  const exact = list.find((l) => l.code.toLowerCase() === clean.toLowerCase());
  if (exact) return exact.code;
  let primary = clean.split("-")[0].toLowerCase();
  primary = families[primary] ?? primary;
  return list.find((l) => l.code.toLowerCase() === primary.toLowerCase())?.code;
}

/** The row for a code, or English's when CloudBank does not speak it. */
export function languageOf(code: string | null | undefined): Language {
  const found = languages.find((l) => l.code === normalizeLanguage(code));
  return found ?? languages[0];
}
