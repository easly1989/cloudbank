// The payees page's model (#554): each payee with what it held over the last
// twelve months and what it is usually given, in the order and under the
// filters the page shows them. Pure: no React.
import type { Category, Payee, PayeeActivity } from "../../api/client";
import { fold } from "../categories/categoryTree";

export interface PayeeRow {
  payee: Payee;
  count: number;
  amount: number;
  /** Its latest transaction, however long ago; null when it never had one. */
  lastDate: string | null;
  defaultCategory: Category | null;
  /** The category worth offering as its default: set only while it has none,
      and only when that category holds at least half of its transactions that
      have one. */
  suggested: Category | null;
  suggestedCount: number;
  /** The payment mode it is most often paid with, "none" aside. */
  usualPaymentMode: number | null;
}

/** Whether a usual category is common enough to offer: at least half. */
export const worthSuggesting = (a: PayeeActivity) =>
  a.usualCategoryId != null &&
  a.categorisedCount > 0 &&
  a.usualCategoryCount * 2 >= a.categorisedCount;

export function buildRows(
  payees: Payee[],
  activity: PayeeActivity[],
  categories: Category[],
): PayeeRow[] {
  const act = new Map(activity.map((a) => [a.payeeId, a]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  return payees.map((p) => {
    const a = act.get(p.id);
    const defaultCategory = (p.defaultCategoryId != null && cat.get(p.defaultCategoryId)) || null;
    const suggested =
      !defaultCategory && a && worthSuggesting(a) ? (cat.get(a.usualCategoryId!) ?? null) : null;
    return {
      payee: p,
      count: a?.count ?? 0,
      amount: a?.amount ?? 0,
      lastDate: a?.lastDate || null,
      defaultCategory,
      suggested,
      suggestedCount: suggested ? a!.usualCategoryCount : 0,
      usualPaymentMode: a?.usualPaymentMode ?? null,
    };
  });
}

export type SortKey = "name" | "count" | "last" | "amount";
export interface Sort {
  key: SortKey;
  desc: boolean;
}

/** Each column's first direction: names A to Z, figures the largest first. */
export const firstDirection = (key: SortKey): Sort => ({ key, desc: key !== "name" });

export const DEFAULT_SORT: Sort = firstDirection("amount");

export interface Filter {
  query: string;
  noDefault: boolean;
  unusedOnly: boolean;
}

export const isUnused = (r: PayeeRow) => r.count === 0;

/** The rows the filter leaves, in the order asked. Ties go by name. */
export function arrange(rows: PayeeRow[], f: Filter, sort: Sort): PayeeRow[] {
  const q = fold(f.query);
  const byName = (a: PayeeRow, b: PayeeRow) => a.payee.name.localeCompare(b.payee.name);
  const value = (r: PayeeRow): number | string => {
    switch (sort.key) {
      case "count":
        return r.count;
      case "last":
        return r.lastDate ?? "";
      case "amount":
        return Math.abs(r.amount);
      default:
        return "";
    }
  };
  const out = rows.filter(
    (r) =>
      (!q || fold(r.payee.name).includes(q)) &&
      (!f.noDefault || !r.defaultCategory) &&
      (!f.unusedOnly || isUnused(r)),
  );
  return out.sort((a, b) => {
    if (sort.key === "name") return sort.desc ? byName(b, a) : byName(a, b);
    const va = value(a);
    const vb = value(b);
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return (sort.desc ? -c : c) || byName(a, b);
  });
}

/** A category's name, with its group's before it for a subcategory. */
export function categoryLabel(c: Category, categories: Category[]): string {
  const parent = c.parentId ? categories.find((p) => p.id === c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}
