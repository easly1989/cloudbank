import type { BudgetReportRow } from "../../api/client";
import { toCivilDate } from "../../civilDate";

// What the overview says needs doing, worked out apart from the component so
// the rules can be read and tested on their own.
//
// The strip is not a widget on purpose. Widgets are yours to remove, and an
// overdue bill is not a preference: if it could be hidden, the one person who
// hid it is exactly the person who then misses it.

/** One line in the strip: a count, what it is about, and where to fix it. */
export interface AttentionItem {
  /** i18n key suffix, e.g. "needsCategory". */
  key: string;
  count: number;
  /** Where the action link goes. */
  to: string;
}

export interface AttentionInput {
  needsCategory: number;
  overdueBills: number;
  overBudget: number;
  duplicates: number;
}

/**
 * The lines worth showing, most actionable first.
 *
 * Anything at zero is left out rather than shown as "0 of these" — a strip that
 * always has four lines stops being a signal and becomes furniture. When
 * everything is at zero the strip does not render at all.
 */
export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const all: AttentionItem[] = [
    { key: "needsCategory", count: input.needsCategory, to: "/review" },
    { key: "overdueBills", count: input.overdueBills, to: "/bills" },
    { key: "overBudget", count: input.overBudget, to: "/budget" },
    { key: "duplicates", count: input.duplicates, to: "/review" },
  ];
  return all.filter((i) => i.count > 0);
}

/**
 * How many spending categories have gone past their budget.
 *
 * Income rows are skipped: earning more than planned is not a problem. A
 * category with no budget set is skipped too — you cannot overspend a budget
 * that does not exist, and counting those would put every uncategorised corner
 * of the wallet into the warning.
 */
export function countOverBudget(rows: readonly BudgetReportRow[] | undefined): number {
  if (!rows) return 0;
  let n = 0;
  for (const r of rows) {
    if (r.isIncome || r.budget <= 0) continue;
    // Both figures are magnitudes for expenses, so a plain comparison holds.
    if (r.actual > r.budget) n++;
  }
  return n;
}

/** First and last day of the month containing `now`, as civil dates. */
export function monthRange(now: Date = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    from: toCivilDate(new Date(y, m, 1)),
    to: toCivilDate(new Date(y, m + 1, 0)),
  };
}
