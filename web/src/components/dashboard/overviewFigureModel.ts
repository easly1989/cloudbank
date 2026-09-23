import type { MonthPoint } from "../../api/client";

// The rules behind the overview's figure row, kept apart from the component so
// they can be read and tested without rendering anything — the same split as
// confirmContext.ts, and for the same reason: a file that exports both a
// component and its helpers loses Fast Refresh.

/** Which of the three balances a reader has asked to see. */
export type BalanceKey = "bank" | "today" | "future";

export const ALL_BALANCES: BalanceKey[] = ["bank", "today", "future"];

/**
 * The balances to show, from a saved preference.
 *
 * Today alone is the default: it is the figure that answers "how much have I
 * got", and the other two answer narrower questions that not everybody asks. An
 * empty or unusable preference falls back to it rather than showing nothing —
 * a row of figures with no figures in it is a bug, not a choice.
 */
export function pickBalances(saved: readonly string[] | undefined): BalanceKey[] {
  const known = (saved ?? []).filter((k): k is BalanceKey =>
    (ALL_BALANCES as string[]).includes(k),
  );
  const ordered = ALL_BALANCES.filter((k) => known.includes(k));
  return ordered.length > 0 ? ordered : ["today"];
}

/**
 * What was earned and spent over a set of months, and how much of it stayed.
 *
 * `kept` is the share of income that survived the period, and is null when
 * nothing came in — zero divided by zero is not "0%", it is "no answer", and
 * printing 0,0 % for a month with no income says something false.
 */
export function periodTotals(points: readonly MonthPoint[]): {
  earned: number;
  spent: number;
  kept: number | null;
} {
  let earned = 0;
  let spent = 0;
  for (const p of points) {
    earned += p.income;
    spent += p.expense;
  }
  return { earned, spent, kept: earned > 0 ? ((earned - spent) / earned) * 100 : null };
}
