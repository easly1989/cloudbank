// What every report tab is handed by the page: the period, the filters as API
// parameters, the base currency's format, and a way to offer its export.
import type { TFunction } from "i18next";

import type { MoneyFormat } from "../../money";
import type { Period, ReportState } from "./reportState";

/** What the "⋯" menu can download for the tab on screen. */
export interface ReportExport {
  /** The file name, without extension. */
  name: string;
  /** The figures beside the chart, header row first; plain values, dot decimals. */
  rows?: () => (string | number)[][];
  /** The chart as a PNG data URL. */
  png?: () => string | undefined;
}

export interface ReportContext {
  walletId: number;
  state: ReportState;
  set: (patch: Partial<ReportState>) => void;
  period: Period;
  /** Today falls inside the period, so its figures are "so far". */
  current: boolean;
  /** Filters and period as query parameters for the report endpoints. */
  params: Record<string, string>;
  fmt: MoneyFormat;
  isPhone: boolean;
  setExport: (e: ReportExport | null) => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A period's name: "September 2026", "Q3 2026", "2026", "All time". Month names
 * come from the browser in the app's language; `sentence` keeps them lower case
 * where the language wants that mid-sentence ("rispetto ad agosto").
 */
export function periodName(p: Period, t: TFunction, lang: string, sentence = false): string {
  if (p.kind === "all" || !p.from) return t("reports.period.allTime");
  const [y, m] = p.from.split("-").map(Number);
  switch (p.kind) {
    case "month": {
      const name = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(
        new Date(y, m - 1, 1),
      );
      return sentence ? name : cap(name);
    }
    case "quarter":
      return t("reports.period.quarterName", { n: Math.floor((m - 1) / 3) + 1, year: y });
    case "half":
      return t("reports.period.halfName", { n: m <= 6 ? 1 : 2, year: y });
    default:
      return String(y);
  }
}

/**
 * A period inside a sentence, as each language needs it: "in September 2026",
 * "a settembre 2026", "nel 2026"; "Compared with August 2026", "Confronto con il
 * 2025". Italian changes the preposition with the kind of period, so the whole
 * phrase is translated per kind rather than glued around the name.
 */
export function periodPhrase(
  p: Period,
  t: TFunction,
  lang: string,
  form: "in" | "vs" | "atEnd" | "byEnd",
): string {
  return t(`reports.period.${form}.${p.kind}`, { name: periodName(p, t, lang, true) });
}

/** A civil date as a short day and month: "26 Sep", "26 set". */
export function shortDay(iso: string, lang: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(
    new Date(y, m - 1, d),
  );
}

/** A civil date in words: "12 August", "12 agosto". */
export function longDay(iso: string, lang: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "long" }).format(
    new Date(y, m - 1, d),
  );
}

/** Minor units as a plain decimal for a CSV cell: "-1234.50". */
export function csvAmount(minor: number, fracDigits: number): string {
  const neg = minor < 0;
  const s = String(Math.abs(Math.round(minor))).padStart(fracDigits + 1, "0");
  const out = fracDigits > 0 ? `${s.slice(0, -fracDigits)}.${s.slice(-fracDigits)}` : s;
  return neg ? `-${out}` : out;
}

/** Rows as CSV text: every cell quoted when it needs to be. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
