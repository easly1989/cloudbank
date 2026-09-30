// The tags page's model (#556): each tag with what it held over the last twelve
// months and the categories its transactions mostly went to, in the order and
// under the filters the page shows them. Pure: no React.
import type { Category, TagActivity, TagInfo } from "../../api/client";
import { fold } from "../categories/categoryTree";

export interface TagRow {
  tag: TagInfo;
  count: number;
  amount: number;
  /** Its latest transaction, however long ago; null when it never had one. */
  lastDate: string | null;
  /** The categories it was mostly in, the most frequent first. */
  categories: { category: Category; count: number }[];
}

export function buildRows(
  tags: TagInfo[],
  activity: TagActivity[],
  categories: Category[],
): TagRow[] {
  const act = new Map(activity.map((a) => [a.tagId, a]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  return tags.map((tag) => {
    const a = act.get(tag.id);
    return {
      tag,
      count: a?.count ?? 0,
      amount: a?.amount ?? 0,
      lastDate: a?.lastDate || null,
      categories: (a?.categories ?? []).flatMap((c) => {
        const category = cat.get(c.categoryId);
        return category ? [{ category, count: c.count }] : [];
      }),
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
  unusedOnly: boolean;
}

export const isUnused = (r: TagRow) => r.count === 0;

/** The rows the filter leaves, in the order asked. Ties go by name. */
export function arrange(rows: TagRow[], f: Filter, sort: Sort): TagRow[] {
  const q = fold(f.query);
  const byName = (a: TagRow, b: TagRow) => a.tag.name.localeCompare(b.tag.name);
  const value = (r: TagRow): number | string => {
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
    (r) => (!q || fold(r.tag.name).includes(q)) && (!f.unusedOnly || isUnused(r)),
  );
  return out.sort((a, b) => {
    if (sort.key === "name") return sort.desc ? byName(b, a) : byName(a, b);
    const va = value(a);
    const vb = value(b);
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return (sort.desc ? -c : c) || byName(a, b);
  });
}

/** A tag name the server would refuse as taken: tags match exactly, case and
    all, once the outer spaces are gone. */
export const takenBy = (others: string[], name: string) => others.find((n) => n === name.trim());
