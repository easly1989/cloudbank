// Shared helpers and constants for the dashboard widgets (extracted from
// DashboardPage.tsx so each widget lives in its own file). Config types and
// their defaults live here (not in the widget files) so those files export only
// components — keeping React Fast Refresh happy.
import type { Account, DashboardGroupBy } from "../../../api/client";
import { type DatePreset, dateBounds, emptyFilters } from "../../../pages/registerFilters";

export type ChartType = "donut" | "bar";
export type IEStyle = "bars" | "lines";

// Per-instance config for the spending widget.
export type SpendingConfig = {
  period: DatePreset;
  chartType: ChartType;
  groupBy: DashboardGroupBy;
};
export const DEFAULT_SPENDING: SpendingConfig = {
  period: "thisMonth",
  chartType: "donut",
  groupBy: "category",
};

// Per-instance config for the income/expense widget.
export type IEConfig = { months: number; style: IEStyle; net: boolean; cumulative: boolean };
export const DEFAULT_IE: IEConfig = { months: 12, style: "bars", net: false, cumulative: false };

// Per-instance config for the KPI widget.
export type KpiConfig = { metric: "today" | "future" | "bank" };
export const DEFAULT_KPI: KpiConfig = { metric: "today" };

// A fixed, color-blind-friendly palette cycled across spending slices.
export const DONUT_PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
  "#9775fa",
];

// Income/expense trailing windows offered in the chart's period dropdown
// (0 = all dates).
export const IE_MONTHS: number[] = [6, 12, 24, 36, 0];

// Periods offered for the spending widget (the register's "custom" range is
// omitted here to keep the dashboard control a single dropdown).
export const PERIODS: DatePreset[] = [
  "thisMonth",
  "thisQuarter",
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
