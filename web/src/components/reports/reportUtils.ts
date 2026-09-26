// Shared helpers for the report tabs.
import type { ReportBucket } from "../../api/client";
import type { MoneyFormat } from "../../money";
import { toCivilDate } from "../../civilDate";
import { type Filters, dateBounds } from "../../pages/registerFilterModel";

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

// todayBucketKey renders today's date as the bucket key for the given interval,
// matching the server's bucket formats (see report/buckets.go) so the "today"
// marker lands on the right category.
export function todayBucketKey(bucket: ReportBucket, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = toCivilDate;
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

/**
 * The register filters as report query parameters. Every filter the panel shows
 * reaches the server (#487): "hide future" by ending the span today, the user's
 * own civil date, as the register does; the rest as parameters of their own.
 */
export function filterToParams(f: Filters, now = new Date()): Record<string, string> {
  const out: Record<string, string> = {};
  const { from } = dateBounds(f);
  let { to } = dateBounds(f);
  if (f.hideFuture) {
    const today = toCivilDate(now);
    if (!to || to > today) to = today;
  }
  if (from) out.from = from;
  if (to) out.to = to;
  if (f.transfers !== "all") out.transfers = f.transfers;
  if (f.noFlags) out.noFlags = "1";
  if (f.uncategorised) out.uncategorised = "1";
  if (f.status !== null) out.status = String(f.status);
  if (f.payeeId !== null) out.payeeId = String(f.payeeId);
  if (f.categoryId !== null) out.categoryId = String(f.categoryId);
  if (f.tags.length > 0) out.tags = f.tags.join(",");
  if (f.amountMin !== null) out.amountMin = String(f.amountMin);
  if (f.amountMax !== null) out.amountMax = String(f.amountMax);
  if (f.text.trim()) out.text = f.text.trim();
  return out;
}
