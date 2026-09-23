// Pure, URL-serializable filter model for the register. Filtering runs
// client-side over the full account ledger so it is instant and combines (AND)
// without affecting the server-computed running balance on each row.
import type { Category, RegisterRow } from "../api/client";
import { toCivilDate } from "../civilDate";

// Civil date of a local calendar day — never via toISOString(), which is UTC.
const iso = toCivilDate;

export type DatePreset =
  "all" | "thisMonth" | "thisQuarter" | "thisHalf" | "thisYear" | "last30" | "last90" | "custom";

// Quick filter for transfer legs: show everything, only transfers, or hide them.
export type TransferFilter = "all" | "only" | "none";

export interface Filters {
  preset: DatePreset;
  from: string; // custom range (YYYY-MM-DD)
  to: string;
  status: number | null;
  payeeId: number | null;
  categoryId: number | null; // includes child categories
  tags: string[];
  amountMin: number | null; // minor units, signed
  amountMax: number | null;
  text: string; // matches memo/info/payee/category
  hideFuture: boolean; // hide rows dated after today
  transfers: TransferFilter; // all | only transfers | exclude transfers
  noFlags: boolean; // keep only unflagged rows (status === 0)
  uncategorised: boolean; // keep only rows with no category (e.g. just-imported)
}

export const emptyFilters: Filters = {
  preset: "all",
  from: "",
  to: "",
  status: null,
  payeeId: null,
  categoryId: null,
  tags: [],
  amountMin: null,
  amountMax: null,
  text: "",
  hideFuture: false,
  transfers: "all",
  noFlags: false,
  uncategorised: false,
};

// dateBounds resolves a preset (or custom range) to inclusive YYYY-MM-DD bounds.
export function dateBounds(f: Filters, now = new Date()): { from?: string; to?: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (f.preset) {
    case "thisMonth":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "thisQuarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "thisHalf": {
      // Calendar halves: January to June, July to December.
      const h = m < 6 ? 0 : 6;
      return { from: iso(new Date(y, h, 1)), to: iso(new Date(y, h + 6, 0)) };
    }
    case "thisYear":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    case "last30":
      return { from: iso(new Date(y, m, now.getDate() - 29)), to: iso(now) };
    case "last90":
      return { from: iso(new Date(y, m, now.getDate() - 89)), to: iso(now) };
    case "custom":
      return { from: f.from || undefined, to: f.to || undefined };
    default:
      return {};
  }
}

// categoryWithChildren returns the id set matching a category filter (the
// category plus its direct children — the data model is two levels deep).
export function categoryWithChildren(categoryId: number, categories: Category[]): Set<number> {
  const ids = new Set<number>([categoryId]);
  for (const c of categories) if (c.parentId === categoryId) ids.add(c.id);
  return ids;
}

// activeFilterCount counts how many distinct filter facets are set (each of the
// switches/inputs contributes at most one). Used for the collapsed "N active"
// badge and, via isActive, to gate the Clear button.
export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.preset !== "all") n++;
  if (f.status !== null) n++;
  if (f.payeeId !== null) n++;
  if (f.categoryId !== null) n++;
  if (f.tags.length > 0) n++;
  if (f.amountMin !== null) n++;
  if (f.amountMax !== null) n++;
  if (f.text.trim() !== "") n++;
  if (f.hideFuture) n++;
  if (f.transfers !== "all") n++;
  if (f.noFlags) n++;
  if (f.uncategorised) n++;
  return n;
}

/**
 * One active filter, named well enough to put on a chip.
 *
 * `labelKey` and `value` are kept apart so the caller translates: the model
 * knows which facets are on and what they are set to, and nothing about words.
 * `clear` returns the filters with that one facet back at its default, so
 * removing a chip is exactly as precise as it looks.
 */
export interface ActiveFilter {
  id: string;
  labelKey: string;
  /** Already-resolved text, when the facet carries one (a search term, a tag). */
  value?: string;
  clear: (f: Filters) => Filters;
}

/**
 * The filters currently narrowing the register, in the order they are shown.
 *
 * A count told the reader that three filters were on without saying which, so
 * the only way to find out was to open the panel and read every control. A row
 * of chips says what is hiding rows, and lets one of them go without disturbing
 * the others.
 */
export function activeFilters(f: Filters): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const add = (id: string, labelKey: string, clear: (x: Filters) => Filters, value?: string) =>
    out.push({ id, labelKey, value, clear });

  if (f.preset !== "all")
    add("preset", `filters.presets.${f.preset}`, (x) => ({
      ...x,
      preset: "all",
      from: "",
      to: "",
    }));
  if (f.text.trim() !== "")
    add("text", "filters.chip.text", (x) => ({ ...x, text: "" }), f.text.trim());
  if (f.status !== null) add("status", "filters.chip.status", (x) => ({ ...x, status: null }));
  if (f.payeeId !== null) add("payee", "filters.chip.payee", (x) => ({ ...x, payeeId: null }));
  if (f.categoryId !== null)
    add("category", "filters.chip.category", (x) => ({ ...x, categoryId: null }));
  if (f.tags.length > 0)
    add("tags", "filters.chip.tags", (x) => ({ ...x, tags: [] }), f.tags.join(", "));
  if (f.amountMin !== null)
    add("amountMin", "filters.chip.amountMin", (x) => ({ ...x, amountMin: null }));
  if (f.amountMax !== null)
    add("amountMax", "filters.chip.amountMax", (x) => ({ ...x, amountMax: null }));
  if (f.hideFuture)
    add("hideFuture", "filters.chip.hideFuture", (x) => ({ ...x, hideFuture: false }));
  if (f.transfers !== "all")
    add("transfers", `filters.chip.transfers.${f.transfers}`, (x) => ({ ...x, transfers: "all" }));
  if (f.noFlags) add("noFlags", "filters.chip.noFlags", (x) => ({ ...x, noFlags: false }));
  if (f.uncategorised)
    add("uncategorised", "filters.chip.uncategorised", (x) => ({ ...x, uncategorised: false }));
  return out;
}

export function isActive(f: Filters): boolean {
  return activeFilterCount(f) > 0;
}

export function applyFilters(
  rows: RegisterRow[],
  f: Filters,
  categories: Category[],
  now = new Date(),
): RegisterRow[] {
  const { from, to } = dateBounds(f, now);
  const today = iso(now);
  const catIds = f.categoryId != null ? categoryWithChildren(f.categoryId, categories) : null;
  const text = f.text.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.hideFuture && r.date > today) return false;
    if (f.transfers === "only" && r.transferId == null) return false;
    if (f.transfers === "none" && r.transferId != null) return false;
    if (f.noFlags && r.status !== 0) return false;
    if (f.uncategorised && r.categoryId != null) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (f.status !== null && r.status !== f.status) return false;
    if (f.payeeId !== null && r.payeeId !== f.payeeId) return false;
    if (catIds && (r.categoryId == null || !catIds.has(r.categoryId))) return false;
    if (f.tags.length > 0 && !f.tags.some((tag) => r.tags.includes(tag))) return false;
    if (f.amountMin !== null && r.amount < f.amountMin) return false;
    if (f.amountMax !== null && r.amount > f.amountMax) return false;
    if (
      text &&
      ![r.memo, r.info, r.payeeName, r.categoryName].some((v) =>
        (v ?? "").toLowerCase().includes(text),
      )
    )
      return false;
    return true;
  });
}

/** Which column the register is sorted by, and in which direction. */
export interface RegisterSort {
  id: string;
  desc: boolean;
}

/** The columns that can be sorted, and what each one actually compares. */
const SORT_VALUE: Record<string, (r: RegisterRow) => string | number> = {
  date: (r) => r.date,
  payee: (r) => r.payeeName ?? "",
  category: (r) => r.categoryName ?? "",
  note: (r) => r.memo ?? "",
  status: (r) => r.status,
  amount: (r) => r.amount,
  runningBalance: (r) => r.runningBalance,
};

export const isSortable = (columnId: string): boolean => columnId in SORT_VALUE;

/**
 * Sort the register by a column, or leave it in its natural order.
 *
 * The natural order is chronological, which is what a ledger is: the running
 * balance on each row only makes sense read down the page. Sorting by anything
 * else is a way of *finding* a row, not of reading balances, so the running
 * balance stays attached to its own row rather than being recomputed.
 *
 * Rows with equal values keep their relative order (the sort is stable), so
 * sorting by payee still reads chronologically within each payee.
 */
export function sortRegisterRows(rows: RegisterRow[], sort: RegisterSort | null): RegisterRow[] {
  const value = sort && SORT_VALUE[sort.id];
  if (!sort || !value) return rows;
  const dir = sort.desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    // Locale-aware so accented payee names sort where a reader expects, and
    // empty values sink to the bottom whichever way the column is pointing.
    const sa = String(va);
    const sb = String(vb);
    if (sa === "" || sb === "") return sa === sb ? 0 : sa === "" ? 1 : -1;
    return sa.localeCompare(sb) * dir;
  });
}

/**
 * How many rows newer than the top visible one the current filter is hiding.
 *
 * Filtering a register is quietly confusing: ask for everything unreconciled and
 * the newest line on screen can be weeks old, which looks like the balance has
 * stopped matching the account. It hasn't — the newer rows are simply reconciled
 * and filtered out, and today's balance still counts them. The register says so
 * rather than leaving the reader to work it out.
 *
 * Zero when nothing is filtered away, and zero when nothing is visible at all:
 * an empty result is its own message, not this one.
 */
export function hiddenNewerCount(all: RegisterRow[], visible: RegisterRow[]): number {
  if (visible.length === 0 || all.length === 0) return 0;
  const shown = new Set(visible.map((r) => r.id));
  // Dates are civil `YYYY-MM-DD`, so a string comparison is a date comparison.
  let newestShown = visible[0].date;
  for (const r of visible) if (r.date > newestShown) newestShown = r.date;
  let n = 0;
  for (const r of all) if (r.date > newestShown && !shown.has(r.id)) n++;
  return n;
}

// --- URL (de)serialization: only non-default keys are written. ---

export function parseFilters(p: URLSearchParams): Filters {
  const num = (k: string) => (p.has(k) ? Number(p.get(k)) : null);
  return {
    preset: (p.get("dp") as DatePreset) || "all",
    from: p.get("df") ?? "",
    to: p.get("dt") ?? "",
    status: num("st"),
    payeeId: num("pe"),
    categoryId: num("cat"),
    tags: p.get("tg") ? p.get("tg")!.split(",").filter(Boolean) : [],
    amountMin: num("amin"),
    amountMax: num("amax"),
    text: p.get("q") ?? "",
    hideFuture: p.get("hf") === "1",
    transfers: (p.get("xf") as TransferFilter) || "all",
    noFlags: p.get("nf") === "1",
    uncategorised: p.get("unc") === "1",
  };
}

export function filtersToParams(f: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.preset !== "all") out.dp = f.preset;
  if (f.preset === "custom") {
    if (f.from) out.df = f.from;
    if (f.to) out.dt = f.to;
  }
  if (f.status !== null) out.st = String(f.status);
  if (f.payeeId !== null) out.pe = String(f.payeeId);
  if (f.categoryId !== null) out.cat = String(f.categoryId);
  if (f.tags.length > 0) out.tg = f.tags.join(",");
  if (f.amountMin !== null) out.amin = String(f.amountMin);
  if (f.amountMax !== null) out.amax = String(f.amountMax);
  if (f.text.trim()) out.q = f.text.trim();
  if (f.hideFuture) out.hf = "1";
  if (f.transfers !== "all") out.xf = f.transfers;
  if (f.noFlags) out.nf = "1";
  if (f.uncategorised) out.unc = "1";
  return out;
}
