// The text of an AI report (#696), cut for display, and the names of the
// periods reports are about (#697).

import type { TFunction } from "i18next";

import type { AIReportKind } from "../api/ai";
import { asTitle } from "../dates";

// An amount as the model writes one: 2540.00 EUR, 2.540,00 €, € 12.40.
const AMOUNT = /([+\-−]?(?:[€$£]\s?)?\d{1,3}(?:[.,'\s]?\d{3})*[.,]\d{2}(?:\s?(?:[€$£]|[A-Z]{3}))?)/;

/** The text cut round its amounts: the amounts are at the odd indexes. */
export const splitAmounts = (text: string) => text.split(AMOUNT);

/** The paragraphs of a report, which the model separates with a blank line. */
export const paragraphs = (body: string) => body.split(/\n\s*\n/).filter((p) => p.trim() !== "");

/** "September 2026", or with year false "September", in the app's language. */
export function monthName(period: string, lang: string, year = true): string {
  const [y, m] = period.split("-").map(Number);
  return asTitle(
    new Intl.DateTimeFormat(lang, {
      month: "long",
      year: year ? "numeric" : undefined,
      timeZone: "UTC",
    }).format(Date.UTC(y, m - 1, 1)),
    lang,
  );
}

/** The day a week's Monday YYYY-MM-DD moves to, n days on. */
function addDays(day: string, n: number): Date {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** What period a report is about: "September 2026", "Week 12–18 October", "Year 2025". */
export function periodLabel(
  r: { kind: AIReportKind; period: string },
  lang: string,
  t: TFunction,
): string {
  if (r.kind === "yearly") return t("insights.year", { year: r.period });
  if (r.kind === "weekly") {
    const range = new Intl.DateTimeFormat(lang, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).formatRange(addDays(r.period, 0), addDays(r.period, 6));
    return t("insights.week", { range });
  }
  return monthName(r.period, lang);
}
