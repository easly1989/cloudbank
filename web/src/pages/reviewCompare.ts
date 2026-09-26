// The field-by-field comparison of a suspected duplicate pair (#484): one row
// per field, the two transactions side by side, so what they share and where
// they differ can be read before choosing which one to keep.

/** The fields compared, in the order they are shown. */
export const COMPARE_FIELDS = [
  "amount",
  "account",
  "transfer",
  "payee",
  "category",
  "memo",
  "info",
  "paymentMode",
  "status",
  "tags",
] as const;
export type CompareField = (typeof COMPARE_FIELDS)[number];

/** A transaction's fields as the reader sees them; "" is "nothing there". */
export type Described = Record<CompareField, string>;

export interface CompareRow {
  field: CompareField;
  a: string;
  b: string;
  /** Both say the same: shown dimmed, so the differences stand out. */
  same: boolean;
}

/**
 * The rows to show for a pair. A field empty on both sides is left out: a row
 * of two dashes says nothing and pushes the ones that matter apart.
 */
export function compareRows(a: Described, b: Described): CompareRow[] {
  return COMPARE_FIELDS.filter((f) => a[f] !== "" || b[f] !== "").map((field) => ({
    field,
    a: a[field],
    b: b[field],
    same: a[field] === b[field],
  }));
}
