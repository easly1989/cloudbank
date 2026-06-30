// Pure, URL-serializable filter model for the register. Filtering runs
// client-side over the full account ledger so it is instant and combines (AND)
// without affecting the server-computed running balance on each row.
import type { Category, RegisterRow } from "../api/client";

export type DatePreset =
  | "all"
  | "thisMonth"
  | "thisQuarter"
  | "thisYear"
  | "last30"
  | "last90"
  | "custom";

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
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

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

export function isActive(f: Filters): boolean {
  return (
    f.preset !== "all" ||
    f.status !== null ||
    f.payeeId !== null ||
    f.categoryId !== null ||
    f.tags.length > 0 ||
    f.amountMin !== null ||
    f.amountMax !== null ||
    f.text.trim() !== "" ||
    f.hideFuture
  );
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
  return out;
}
