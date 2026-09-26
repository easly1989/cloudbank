// What a report shows — tab, period, filters and each tab's own choices — as a
// plain value that lives in the URL, so a report can be reloaded, shared and
// saved exactly as it looks. Pure: no React, no translations.
import type { SavedReportView } from "../../api/client";
import { toCivilDate } from "../../civilDate";
import {
  type Filters,
  type TransferFilter,
  emptyFilters,
  filtersToParams,
  parseFilters,
} from "../../pages/registerFilterModel";
import { filterToParams } from "./reportUtils";

export type ReportTab = "spending" | "cashflow" | "balances" | "vehicle";
export const REPORT_TABS: ReportTab[] = ["spending", "cashflow", "balances", "vehicle"];

export type PeriodKind = "month" | "quarter" | "half" | "year" | "all";
export const PERIOD_KINDS: PeriodKind[] = ["month", "quarter", "half", "year", "all"];

export type SpendType = "expense" | "income";
export type SpendBy = "category" | "payee" | "tag";
export type FlowBucket = "week" | "month" | "quarter";
export const FLOW_BUCKETS: FlowBucket[] = ["week", "month", "quarter"];

export interface ReportState {
  tab: ReportTab;
  /** The period's length; null means the tab's own default (see defaultPeriod). */
  period: PeriodKind | null;
  /** A day inside the period shown; "" means the one containing today. */
  at: string;
  /** The register's filters. Their dates are unused: the period bar sets those. */
  filters: Filters;
  type: SpendType;
  by: SpendBy;
  /** Cash flow's bar length; null means the default for the period. */
  bucket: FlowBucket | null;
  /** Balances' accounts; empty means all of them. */
  accounts: number[];
  vehicle: number | null;
}

/**
 * Transfers between one's own accounts are neither spending nor income, so the
 * reports leave them out unless asked: the one filter whose report default is
 * not the register's.
 */
export const REPORT_TRANSFERS: TransferFilter = "none";

export const initialReportState: ReportState = {
  tab: "spending",
  period: null,
  at: "",
  filters: { ...emptyFilters, transfers: REPORT_TRANSFERS },
  type: "expense",
  by: "category",
  bucket: null,
  accounts: [],
  vehicle: null,
};

/** Spending reads best a month at a time; the others need a year to show a shape. */
export function defaultPeriod(tab: ReportTab): PeriodKind {
  return tab === "spending" ? "month" : "year";
}

export function effectivePeriod(s: ReportState): PeriodKind {
  return s.period ?? defaultPeriod(s.tab);
}

/** Cash flow's default bar: enough bars to see a shape, few enough to read. */
export function defaultBucket(kind: PeriodKind): FlowBucket {
  switch (kind) {
    case "month":
    case "quarter":
      return "week";
    case "all":
      return "quarter";
    default:
      return "month";
  }
}

const oneOf = <T extends string>(v: string | null, all: readonly T[]): T | null =>
  v !== null && (all as readonly string[]).includes(v) ? (v as T) : null;

const isDay = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

// The register's own filter keys, minus its dates.
const DATE_KEYS = ["dp", "df", "dt"];

export function parseReportState(p: URLSearchParams): ReportState {
  const filters = parseFilters(p);
  // No "xf" is the report default, not the register's "all".
  filters.transfers = oneOf(p.get("xf"), ["all", "only", "none"] as const) ?? REPORT_TRANSFERS;
  filters.preset = "all";
  filters.from = "";
  filters.to = "";
  const vehicle = Number(p.get("v"));
  return {
    tab: oneOf(p.get("tab"), REPORT_TABS) ?? initialReportState.tab,
    period: oneOf(p.get("p"), PERIOD_KINDS),
    at: isDay(p.get("at")) ? p.get("at")! : "",
    filters,
    type: oneOf(p.get("ty"), ["expense", "income"] as const) ?? "expense",
    by: oneOf(p.get("by"), ["category", "payee", "tag"] as const) ?? "category",
    bucket: oneOf(p.get("b"), FLOW_BUCKETS),
    accounts: (p.get("acc") ?? "")
      .split(",")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
    vehicle: Number.isInteger(vehicle) && vehicle > 0 ? vehicle : null,
  };
}

/** The state as query parameters, writing only what differs from the defaults. */
export function reportStateToParams(s: ReportState): Record<string, string> {
  const out: Record<string, string> = {};
  if (s.tab !== initialReportState.tab) out.tab = s.tab;
  if (s.period) out.p = s.period;
  if (s.at) out.at = s.at;
  const f = filtersToParams(s.filters);
  for (const k of DATE_KEYS) delete f[k];
  if (s.filters.transfers === REPORT_TRANSFERS) delete f.xf;
  else f.xf = s.filters.transfers;
  Object.assign(out, f);
  if (s.type !== "expense") out.ty = s.type;
  if (s.by !== "category") out.by = s.by;
  if (s.bucket) out.b = s.bucket;
  if (s.accounts.length > 0) out.acc = s.accounts.join(",");
  if (s.vehicle !== null) out.v = String(s.vehicle);
  return out;
}

// --- Periods -------------------------------------------------------------

export interface Period {
  kind: PeriodKind;
  /** Inclusive civil bounds; both absent for "all". */
  from?: string;
  to?: string;
}

const parseDay = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** The months a period of this kind spans. */
const MONTHS: Record<Exclude<PeriodKind, "all">, number> = {
  month: 1,
  quarter: 3,
  half: 6,
  year: 12,
};

/** The period of this kind containing `at` (or today, when `at` is ""). */
export function periodOf(kind: PeriodKind, at: string, now = new Date()): Period {
  if (kind === "all") return { kind };
  const d = at ? parseDay(at) : now;
  const len = MONTHS[kind];
  const startMonth = Math.floor(d.getMonth() / len) * len;
  const y = d.getFullYear();
  return {
    kind,
    from: toCivilDate(new Date(y, startMonth, 1)),
    to: toCivilDate(new Date(y, startMonth + len, 0)),
  };
}

/** The period just before, of the same kind: August for September. */
export function previousPeriod(p: Period): Period | null {
  if (p.kind === "all" || !p.from) return null;
  const d = parseDay(p.from);
  d.setDate(0); // the last day of the month before
  return periodOf(p.kind, toCivilDate(d));
}

/**
 * The `at` for the neighbouring period: its first day, or "" when that is the
 * period containing today, so the URL of "now" stays short and stays "now".
 */
export function shiftPeriod(kind: PeriodKind, at: string, dir: -1 | 1, now = new Date()): string {
  const p = periodOf(kind, at, now);
  if (!p.from) return "";
  const d = parseDay(p.from);
  const next = new Date(
    d.getFullYear(),
    d.getMonth() + dir * MONTHS[kind as keyof typeof MONTHS],
    1,
  );
  const day = toCivilDate(next);
  const today = toCivilDate(now);
  const target = periodOf(kind, day, now);
  return target.from! <= today && today <= target.to! ? "" : day;
}

/** Whether today falls inside the period: its figures are still "so far". */
export function isCurrentPeriod(p: Period, now = new Date()): boolean {
  if (!p.from || !p.to) return true;
  const today = toCivilDate(now);
  return p.from <= today && today <= p.to;
}

/** The report's filters and period as API query parameters. */
export function reportApiParams(
  filters: Filters,
  period: Period,
  now = new Date(),
): Record<string, string> {
  return filterToParams(
    { ...filters, preset: "custom", from: period.from ?? "", to: period.to ?? "" },
    now,
  );
}

// --- Saved views -----------------------------------------------------------

/** The saved-view tab name of views saved since the redesign: one for all tabs. */
export const VIEW_TAB = "reports";

/**
 * A saved view as a query string, or null when there is nothing to restore.
 *
 * Views saved before the redesign belong to the Statistics or Trend tab and hold
 * that tab's own settings; they open on the tab that took each one's place, with
 * their filters. Their chart type and date preset have no counterpart any more.
 */
export function viewToSearch(view: SavedReportView): string | null {
  const c = view.config;
  if (view.tab === VIEW_TAB) return typeof c.search === "string" ? c.search : null;
  if (view.tab !== "statistics" && view.tab !== "trend") return null;
  const s: ReportState = {
    ...initialReportState,
    tab: view.tab === "trend" ? "cashflow" : "spending",
  };
  if (c.filters && typeof c.filters === "object") {
    s.filters = {
      ...s.filters,
      ...(c.filters as Partial<Filters>),
      preset: "all",
      from: "",
      to: "",
    };
  }
  const by = c.groupBy === "subcategory" ? "category" : c.groupBy;
  if (by === "category" || by === "payee" || by === "tag") s.by = by;
  return new URLSearchParams(reportStateToParams(s)).toString();
}
