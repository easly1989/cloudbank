import type { BudgetMonth, BudgetReport, BudgetReportRow, Category } from "../../api/client";

export type PeriodKind = "month" | "year";

/** The period the page shows: a calendar month or a calendar year. */
export interface Period {
  kind: PeriodKind;
  year: number;
  /** 1..12; the month a year view came from, kept so Month goes back to it. */
  month: number;
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export function periodOf(kind: PeriodKind, year: number, month: number): Period {
  return kind === "year"
    ? { kind, year, month, from: `${year}-01-01`, to: `${year}-12-31` }
    : {
        kind,
        year,
        month,
        from: `${year}-${pad(month)}-01`,
        to: `${year}-${pad(month)}-${pad(lastDay(year, month))}`,
      };
}

/** The period containing a civil date. */
export const periodAt = (kind: PeriodKind, date: string) =>
  periodOf(kind, Number(date.slice(0, 4)), Number(date.slice(5, 7)));

/** The period `delta` months or years away: ‹ and ›. */
export function shiftPeriod(p: Period, delta: number): Period {
  if (p.kind === "year") return periodOf("year", p.year + delta, p.month);
  const i = p.year * 12 + (p.month - 1) + delta;
  return periodOf("month", Math.floor(i / 12), (i % 12) + 1);
}

const DAY = 86_400_000;
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * How far through the period today is, 0..1, counting today as gone; null
 * when today is outside it, or its last day, where a tick would say nothing.
 * The tick on the bars stands there.
 */
export function paceOf(p: Pick<Period, "from" | "to">, today: string): number | null {
  if (today < p.from || today >= p.to) return null;
  return (at(today) + DAY - at(p.from)) / (at(p.to) + DAY - at(p.from));
}

/** The days left in the period after today; null when today is outside it. */
export function daysLeft(p: Pick<Period, "from" | "to">, today: string): number | null {
  if (today < p.from || today > p.to) return null;
  return Math.round((at(p.to) - at(today)) / DAY);
}

/**
 * One line of the page, as magnitudes: what was planned, what has gone (up to
 * today), and what is entered but dated later. Spending and income alike read
 * as positive numbers.
 */
export interface BudgetLine {
  id: number;
  name: string;
  /** The parent's name, for "Food › Groceries". */
  parent?: string;
  income: boolean;
  budgeted: boolean;
  plan: number;
  spent: number;
  coming: number;
}

/** What is left of the plan once what has gone and what is coming are out. */
export const leftOf = (l: Pick<BudgetLine, "plan" | "spent" | "coming">) =>
  l.plan - l.spent - l.coming;

/** A spending line past its plan. Income past its plan is not a problem. */
export const isOver = (l: BudgetLine) => !l.income && l.budgeted && leftOf(l) < 0;

function lineOf(r: BudgetReportRow, categories: Category[]): BudgetLine {
  const sign = r.isIncome ? 1 : -1;
  const c = categories.find((x) => x.id === r.categoryId);
  const parent = c?.parentId ? categories.find((x) => x.id === c.parentId)?.name : undefined;
  return {
    id: r.categoryId,
    name: c?.name ?? r.name,
    parent,
    income: r.isIncome,
    budgeted: r.budgeted,
    plan: sign * r.budget,
    spent: sign * (r.actual - r.coming),
    coming: sign * r.coming,
  };
}

export interface BudgetView {
  /** The budgeted spending, largest plan first. */
  spending: BudgetLine[];
  /** Spending with no budget, largest first; not over anything. */
  loose: BudgetLine[];
  /** The budgeted income, largest plan first. */
  income: BudgetLine[];
  /** Over the budgeted spending. */
  total: Pick<BudgetLine, "plan" | "spent" | "coming">;
  looseTotal: number;
  incomeTotal: Pick<BudgetLine, "plan" | "spent" | "coming">;
  over: number;
}

export function viewOf(report: BudgetReport | undefined, categories: Category[]): BudgetView {
  const lines = (report?.rows ?? []).map((r) => lineOf(r, categories));
  const byPlan = (a: BudgetLine, b: BudgetLine) => b.plan - a.plan || a.name.localeCompare(b.name);
  const spending = lines.filter((l) => l.budgeted && !l.income).sort(byPlan);
  const income = lines.filter((l) => l.budgeted && l.income).sort(byPlan);
  const loose = lines
    .filter((l) => !l.budgeted && !l.income && l.spent + l.coming > 0)
    .sort((a, b) => b.spent + b.coming - (a.spent + a.coming) || a.name.localeCompare(b.name));
  const sum = (ls: BudgetLine[]) => ({
    plan: ls.reduce((s, l) => s + l.plan, 0),
    spent: ls.reduce((s, l) => s + l.spent, 0),
    coming: ls.reduce((s, l) => s + l.coming, 0),
  });
  return {
    spending,
    loose,
    income,
    total: report
      ? {
          plan: -report.totalBudget,
          spent: -(report.totalActual - report.totalComing),
          coming: -report.totalComing,
        }
      : { plan: 0, spent: 0, coming: 0 },
    looseTotal: loose.reduce((s, l) => s + l.spent, 0),
    incomeTotal: sum(income),
    over: spending.filter(isOver).length,
  };
}

/** "Food › Groceries", or the name alone. */
export const pathOf = (l: Pick<BudgetLine, "name" | "parent">) =>
  l.parent ? `${l.parent} › ${l.name}` : l.name;

/** The months a plan covers, as budgets are kept: "same" or twelve values. */
export interface Plan {
  mode: "same" | "monthly";
  same: number;
  monthly: number[];
}

/** The plan for one month (1..12), as a magnitude. */
export const planFor = (p: Plan, month: number) =>
  Math.abs(p.mode === "same" ? p.same : (p.monthly[month - 1] ?? 0));

export interface HistoryStats {
  total: number;
  average: number;
  /** The months over the plan, of those shown. */
  over: number;
  /** The average, rounded to five of the currency: what "Plan X a month" sets. */
  suggestion: number;
}

/**
 * What the history says about a category: its total and monthly average, as
 * magnitudes, and how often it went past the plan.
 */
export function historyStats(
  months: BudgetMonth[],
  income: boolean,
  plan: Plan,
  fracDigits: number,
): HistoryStats {
  const sign = income ? 1 : -1;
  const values = months.map((m) => sign * m.amount);
  const total = values.reduce((s, v) => s + v, 0);
  const average = months.length ? total / months.length : 0;
  const five = 5 * 10 ** fracDigits;
  const over = income
    ? 0
    : months.filter((m, i) => {
        const p = planFor(plan, Number(m.month.slice(5, 7)));
        return p > 0 && values[i] > p;
      }).length;
  return { total, average, over, suggestion: Math.round(average / five) * five };
}

/** The twelve complete months before the one `today` falls in, oldest first. */
export function lastTwelve(months: BudgetMonth[], today: string): BudgetMonth[] {
  return months.filter((m) => m.month < today.slice(0, 7)).slice(-12);
}
