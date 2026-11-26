// Merging two register rows into one, field by field (#786). Column 1 is the
// bank's row, the one that stays and keeps its import ref; for each field the
// reader picks which row it comes from.
import type { RegisterRow, Transaction } from "../api/client";

/** The fields that can come from either row, in the order they are shown. */
export const MERGE_FIELDS = [
  "date",
  "payee",
  "category",
  "memo",
  "tags",
  "status",
  "amount",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
/** 0 is column 1 (the bank's row, kept), 1 is the other. */
export type Side = 0 | 1;
export type Picks = Record<MergeField, Side>;
/** What the dialog needs of a row: the register's names plus the whole record. */
export type MergeRow = Transaction & Partial<Pick<RegisterRow, "payeeName" | "categoryName">>;

// A bank's ref beats a mail's ("mail:…", #657), which beats none.
const refRank = (t: Transaction) => (!t.importRef ? 0 : t.importRef.startsWith("mail:") ? 1 : 2);

/**
 * The two rows, the bank's first: the one with a bank import ref, else a
 * mail's, else (both or neither) the older one, entered first.
 */
export function bankFirst<T extends Transaction>(a: T, b: T): [T, T] {
  const ra = refRank(a);
  const rb = refRank(b);
  if (ra !== rb) return ra > rb ? [a, b] : [b, a];
  return a.id <= b.id ? [a, b] : [b, a];
}

/** A field as compared: equal strings mean the two rows say the same. */
export function fieldKey(t: Transaction, f: MergeField): string {
  switch (f) {
    case "payee":
      return String(t.payeeId ?? "");
    case "category":
      return String(t.categoryId ?? "");
    case "memo":
      return t.memo.trim();
    case "tags":
      return [...t.tags].sort().join("\n");
    default:
      return String(t[f]);
  }
}

export const sameField = (rows: [Transaction, Transaction], f: MergeField) =>
  fieldKey(rows[0], f) === fieldKey(rows[1], f);

// The words of a row: what a person may have filled in.
const WORDS = ["payee", "category", "memo", "tags"] as const;
const filled = (t: Transaction, f: MergeField) => fieldKey(t, f) !== "";

/**
 * The picks the dialog starts from. Date, amount and status are the bank
 * row's: it says when and how much the bank moved. Payee, category, memo and
 * tags come from the more complete row, the one with more of the four filled
 * in; on a tie, from the other row, as what a person typed reads better than
 * the bank's text. A field the chosen row leaves empty comes from the row
 * that has it.
 */
export function defaultPicks(rows: [Transaction, Transaction]): Picks {
  const count = (t: Transaction) => WORDS.filter((f) => filled(t, f)).length;
  const words: Side = count(rows[0]) > count(rows[1]) ? 0 : 1;
  const picks: Picks = { date: 0, amount: 0, status: 0, payee: 0, category: 0, memo: 0, tags: 0 };
  for (const f of WORDS) {
    const other: Side = words === 0 ? 1 : 0;
    picks[f] = filled(rows[words], f) || !filled(rows[other], f) ? words : other;
  }
  return picks;
}

/** The fields the kept row takes from the other one: what the server is sent. */
export const takeFromOther = (rows: [Transaction, Transaction], picks: Picks): MergeField[] =>
  MERGE_FIELDS.filter((f) => picks[f] === 1 && !sameField(rows, f));

/** The row the merge leaves, for the preview under the choices. */
export function mergedRow(rows: [MergeRow, MergeRow], picks: Picks): MergeRow {
  const from = (f: MergeField) => rows[picks[f]];
  return {
    ...rows[0],
    date: from("date").date,
    amount: from("amount").amount,
    status: from("status").status,
    payeeId: from("payee").payeeId,
    payeeName: from("payee").payeeName,
    categoryId: from("category").categoryId,
    categoryName: from("category").categoryName,
    memo: from("memo").memo,
    tags: from("tags").tags,
  };
}

/** Why two rows cannot be merged, or null when they can. */
export function mergeBlock(
  rows: Pick<Transaction, "accountId" | "transferId" | "isSplit">[],
): "accounts" | "transfer" | "split" | null {
  if (rows.some((r) => r.transferId != null)) return "transfer";
  if (rows.some((r) => r.isSplit)) return "split";
  if (new Set(rows.map((r) => r.accountId)).size > 1) return "accounts";
  return null;
}
