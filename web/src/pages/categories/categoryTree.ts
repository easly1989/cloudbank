// The categories page's model (#552): the wallet's categories as groups and
// their subcategories, each with what it held over the last twelve months, in
// the order and under the filters the page shows them. Pure: no React.
import type { Category, CategoryActivity } from "../../api/client";

export type Kind = "expense" | "income";
export type KindFilter = "all" | Kind;

export interface CategoryNode {
  category: Category;
  /** Its own lines in the period. */
  count: number;
  amount: number;
  /** Its latest line, however long ago; null when it never had one. */
  lastDate: string | null;
  /** A group's subcategories; empty for a subcategory. */
  subs: CategoryNode[];
  /** Its own figures plus its subcategories'. The same as its own for a subcategory. */
  totalCount: number;
  total: number;
  lastAny: string | null;
}

export interface Section {
  kind: Kind;
  groups: CategoryNode[];
  /** Every line in the section, and their sum. */
  count: number;
  total: number;
}

const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));

const byMagnitude = (a: number, b: number, an: string, bn: string) =>
  Math.abs(b) - Math.abs(a) || an.localeCompare(bn);

/**
 * The categories as two sections, spending then income, each group holding its
 * subcategories. Groups go by the size of their total, subcategories by their
 * own amount, the largest first, and by name where two are equal.
 */
export function buildSections(
  categories: Category[],
  activity: CategoryActivity[],
): Record<Kind, Section> {
  const act = new Map(activity.map((a) => [a.categoryId, a]));
  const node = (c: Category): CategoryNode => {
    const a = act.get(c.id);
    const count = a?.count ?? 0;
    const amount = a?.amount ?? 0;
    const lastDate = a?.lastDate || null;
    return {
      category: c,
      count,
      amount,
      lastDate,
      subs: [],
      totalCount: count,
      total: amount,
      lastAny: lastDate,
    };
  };
  const groups = new Map<number, CategoryNode>();
  for (const c of categories) if (!c.parentId) groups.set(c.id, node(c));
  for (const c of categories) {
    const g = c.parentId ? groups.get(c.parentId) : undefined;
    if (g) g.subs.push(node(c));
  }
  const sections: Record<Kind, Section> = {
    expense: { kind: "expense", groups: [], count: 0, total: 0 },
    income: { kind: "income", groups: [], count: 0, total: 0 },
  };
  for (const g of groups.values()) {
    g.subs.sort((a, b) => byMagnitude(a.amount, b.amount, a.category.name, b.category.name));
    for (const s of g.subs) {
      g.totalCount += s.count;
      g.total += s.amount;
      g.lastAny = later(g.lastAny, s.lastDate);
    }
    const sec = sections[g.category.isIncome ? "income" : "expense"];
    sec.groups.push(g);
    sec.count += g.totalCount;
    sec.total += g.total;
  }
  for (const sec of Object.values(sections))
    sec.groups.sort((a, b) => byMagnitude(a.total, b.total, a.category.name, b.category.name));
  return sections;
}

/**
 * Unused: nothing of its own in the period. A group with subcategories is never
 * counted on its own account — it is where they sit, and its figure is theirs.
 */
export const isUnused = (n: CategoryNode) =>
  n.count === 0 && (n.subs.length === 0 || !!n.category.parentId);

/** The unused categories in the sections, subcategories included. */
export function countUnused(sections: Section[]): number {
  let n = 0;
  for (const sec of sections)
    for (const g of sec.groups) {
      if (isUnused(g)) n++;
      n += g.subs.filter(isUnused).length;
    }
  return n;
}

/** A name folded for search: no case, no accents. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface Filter {
  kind: KindFilter;
  query: string;
  unusedOnly: boolean;
}

/**
 * The sections the filter leaves, in the same order. A group whose name matches
 * keeps all its subcategories; otherwise it stays, with only the subcategories
 * that match, when any do. The section figures stay the whole section's: the
 * share of a row is of its section, not of what the search left.
 */
export function filterSections(sections: Record<Kind, Section>, f: Filter): Section[] {
  const q = fold(f.query);
  const kinds: Kind[] = f.kind === "all" ? ["expense", "income"] : [f.kind];
  const out: Section[] = [];
  for (const kind of kinds) {
    const sec = sections[kind];
    const groups: CategoryNode[] = [];
    for (const g of sec.groups) {
      const groupHit = !q || fold(g.category.name).includes(q);
      let subs = groupHit ? g.subs : g.subs.filter((s) => fold(s.category.name).includes(q));
      if (f.unusedOnly) subs = subs.filter(isUnused);
      const selfShown = f.unusedOnly ? groupHit && isUnused(g) : groupHit;
      if (selfShown || subs.length > 0) groups.push({ ...g, subs });
    }
    if (groups.length > 0) out.push({ ...sec, groups });
  }
  return out;
}

/** A row's share of its section, as a whole percentage. */
export const share = (amount: number, total: number) =>
  total === 0 ? 0 : Math.round((Math.abs(amount) / Math.abs(total)) * 100);

/** The largest group total in a section: the full length of a bar. */
export const barScale = (sec: Section) => Math.max(1, ...sec.groups.map((g) => Math.abs(g.total)));

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The last twelve months up to today, both ends included: from the day after
 * today's date a year ago. On 29 February that date is the 28th.
 */
export function lastTwelveMonths(today: string): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const yearAgo = new Date(Date.UTC(y - 1, m - 1, Math.min(d, m === 2 ? 28 : d)));
  yearAgo.setUTCDate(yearAgo.getUTCDate() + 1);
  const from = `${yearAgo.getUTCFullYear()}-${pad(yearAgo.getUTCMonth() + 1)}-${pad(yearAgo.getUTCDate())}`;
  return { from, to: today };
}
