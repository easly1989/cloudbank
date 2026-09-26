// Shared helpers and constants for the dashboard widgets (extracted from
// DashboardPage.tsx so each widget lives in its own file). Config types and
// their defaults live here (not in the widget files) so those files export only
// components — keeping React Fast Refresh happy.
import type { Account, DashboardGroupBy } from "../../../api/client";
import { type DatePreset, dateBounds, emptyFilters } from "../../../pages/registerFilterModel";

// The periods the overview itself offers. Deliberately shorter than PERIODS:
// this is a coarse "how far back am I looking", not the register's filter.
export const PAGE_PERIODS: DatePreset[] = [
  "thisMonth",
  "thisQuarter",
  "thisHalf",
  "thisYear",
  "all",
];

/**
 * A widget period of "follow" means "whatever the page is showing".
 *
 * It is the default for a widget the reader has never configured, which is how
 * the page control can mean something without changing a dashboard somebody
 * already arranged: a saved config is an explicit choice and stays pinned.
 */
export const FOLLOW_PAGE = "follow" as const;
export type WidgetPeriod = DatePreset | typeof FOLLOW_PAGE;

/** Resolve a widget's period against the page's. */
export function effectivePeriod(widget: WidgetPeriod, page: DatePreset): DatePreset {
  return widget === FOLLOW_PAGE ? page : widget;
}

/**
 * The trailing window, in months, that matches a period.
 *
 * The income/expense chart counts months rather than taking a range, so a
 * following instance has to translate. Zero means "all dates", which is what
 * that widget already uses for its own "all" option.
 */
export function periodToMonths(period: DatePreset): number {
  switch (period) {
    case "thisMonth":
      return 1;
    case "thisQuarter":
    case "last90":
      return 3;
    case "thisHalf":
      return 6;
    case "thisYear":
      return 12;
    case "last30":
      return 1;
    default:
      return 0;
  }
}

// "rows" is the default: a list of facts, which is what the tile shows and
// what survives a widget being a third of the page wide.
export type ChartType = "rows" | "donut" | "bar";
export type IEStyle = "bars" | "lines";

// Per-instance config for the spending widget.
export type SpendingConfig = {
  period: WidgetPeriod;
  chartType: ChartType;
  groupBy: DashboardGroupBy;
};
export const DEFAULT_SPENDING: SpendingConfig = {
  // A widget nobody has configured follows the page.
  period: FOLLOW_PAGE,
  chartType: "rows",
  groupBy: "category",
};

// Per-instance config for the income/expense widget.
// `months: null` means the instance follows the page period.
export type IEConfig = {
  months: number | null;
  style: IEStyle;
  net: boolean;
  cumulative: boolean;
};
export const DEFAULT_IE: IEConfig = { months: null, style: "bars", net: false, cumulative: false };

// Per-instance config for the KPI widget.
export type KpiConfig = { metric: "today" | "future" | "bank" };
export const DEFAULT_KPI: KpiConfig = { metric: "today" };

// Income/expense trailing windows offered in the chart's period dropdown
// (0 = all dates).
export const IE_MONTHS: number[] = [6, 12, 24, 36, 0];

// Periods offered for the spending widget (the register's "custom" range is
// omitted here to keep the dashboard control a single dropdown).
export const PERIODS: DatePreset[] = [
  "thisMonth",
  "thisQuarter",
  "thisHalf",
  "thisYear",
  "last30",
  "last90",
  "all",
];

// resolveBounds turns a preset into explicit inclusive YYYY-MM-DD bounds. "all"
// (and any open-ended preset) becomes wide sentinels so the request always
// carries a range and the server does not fall back to the current month.
export function resolveBounds(period: DatePreset): { from: string; to: string } {
  if (period === "all") return { from: "0001-01-01", to: "9999-12-31" };
  const b = dateBounds({ ...emptyFilters, preset: period });
  return { from: b.from ?? "0001-01-01", to: b.to ?? "9999-12-31" };
}

// accountFmt maps an account's currency metadata to the money formatter shape.
export function accountFmt(a: Account) {
  return {
    fracDigits: a.currencyFracDigits,
    decimalChar: a.currencyDecimalChar,
    groupChar: a.currencyGroupChar,
    symbol: a.currencySymbol,
    symbolPrefix: a.currencySymbolPrefix,
  };
}

// trailingYearBounds returns a [from, to] window covering the last ~12 months
// (from the 1st of the month a year ago through today), for the balance-report
// based trend widgets.
export function trailingYearBounds(): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const to = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const from = `${now.getFullYear() - 1}-${pad(now.getMonth() + 1)}-01`;
  return { from, to };
}
