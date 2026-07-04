// Shared helpers and constants for the report tabs (extracted from
// ReportsPage.tsx so each tab lives in its own file).
import type { ReportBucket, ReportGroupBy, TrendBreakdown } from "../../api/client";
import type { MoneyFormat } from "../../money";
import { type Filters, dateBounds } from "../../pages/registerFilters";

export const BUCKETS: ReportBucket[] = ["day", "week", "month", "quarter", "year"];
export const BREAKDOWNS: TrendBreakdown[] = ["none", "account", "payee", "category"];
export const GROUPS: ReportGroupBy[] = ["category", "subcategory", "payee", "tag", "month", "year"];

export const SERIES_PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
];
export const PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
  "#9775fa",
  "#f783ac",
];

export function baseFmt(
  currency:
    | {
        fracDigits: number;
        decimalChar: string;
        groupChar: string;
        symbol: string;
        symbolPrefix: boolean;
      }
    | null
    | undefined,
): MoneyFormat {
  return currency
    ? {
        fracDigits: currency.fracDigits,
        decimalChar: currency.decimalChar,
        groupChar: currency.groupChar,
        symbol: currency.symbol,
        symbolPrefix: currency.symbolPrefix,
      }
    : { fracDigits: 2, decimalChar: ".", groupChar: ",", symbol: "", symbolPrefix: false };
}

// previousPeriod returns the equal-length window ending the day before `from`,
// used for period-over-period comparison.
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const day = 86400000;
  const f = Date.parse(from + "T00:00:00Z");
  const t = Date.parse(to + "T00:00:00Z");
  const len = Math.round((t - f) / day) + 1; // inclusive day count
  const prevTo = f - day;
  const prevFrom = prevTo - (len - 1) * day;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(prevFrom), to: iso(prevTo) };
}

export function cumulate(values: number[]): number[] {
  let acc = 0;
  return values.map((v) => (acc += v));
}

// todayBucketKey renders today's date as the bucket key for the given interval,
// matching the server's bucket formats (see report/buckets.go) so the "today"
// marker lands on the right category.
export function todayBucketKey(bucket: ReportBucket, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based
  switch (bucket) {
    case "year":
      return String(y);
    case "quarter":
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "month":
      return `${y}-${pad(m + 1)}`;
    case "week": {
      // Monday of this week (ISO-style), matching the server.
      const d = new Date(y, m, now.getDate());
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return iso(d);
    }
    default:
      return iso(now); // day
  }
}

export function filterToParams(f: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  const { from, to } = dateBounds(f);
  if (from) out.from = from;
  if (to) out.to = to;
  if (f.status !== null) out.status = String(f.status);
  if (f.payeeId !== null) out.payeeId = String(f.payeeId);
  if (f.categoryId !== null) out.categoryId = String(f.categoryId);
  if (f.tags.length > 0) out.tags = f.tags.join(",");
  if (f.amountMin !== null) out.amountMin = String(f.amountMin);
  if (f.amountMax !== null) out.amountMax = String(f.amountMax);
  if (f.text.trim()) out.text = f.text.trim();
  return out;
}
