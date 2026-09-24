// Which of the entry sheet's fields sit in its base and which under "More
// details", and how the base packs into rows.
//
// The base is what the app needs to record a transaction — the account, the
// date, the amount, how it was paid, its status, a memo — plus the category,
// which budgets and reports are built from. Everything else is detail. A reader
// can move any field either way in Settings; nothing is ever hidden outright, so
// every field stays one click away.
//
// The amount is not in this list: it is the one field every transaction has, so
// it is always first and always visible.

export type EntryField =
  | "date"
  | "account"
  | "memo"
  | "paymentMode"
  | "category"
  | "status"
  | "payee"
  | "info"
  | "vehicle"
  | "tags";

export type Placement = "base" | "more";

/**
 * Every movable field, in the order the sheet draws them. `wide` fields take a
 * row of their own; the rest pair up with the next narrow one. `required` fields
 * are the ones a save needs: moved out of the base, they start from a default,
 * which Settings says out loud.
 */
export const ENTRY_FIELDS: {
  id: EntryField;
  labelKey: string;
  def: Placement;
  wide?: boolean;
  required?: boolean;
}[] = [
  { id: "date", labelKey: "transactions.date", def: "base", required: true },
  { id: "account", labelKey: "transactions.account", def: "base", required: true },
  { id: "memo", labelKey: "transactions.memo", def: "base", wide: true },
  { id: "paymentMode", labelKey: "transactions.paymentMode", def: "base" },
  { id: "category", labelKey: "transactions.category", def: "base" },
  { id: "status", labelKey: "transactions.status", def: "base", wide: true },
  { id: "payee", labelKey: "transactions.payee", def: "more" },
  { id: "info", labelKey: "transactions.info", def: "more" },
  { id: "vehicle", labelKey: "transactions.vehicle", def: "more" },
  { id: "tags", labelKey: "transactions.tags", def: "more", wide: true },
];

/** Where each field goes: the saved choice, or the default for any not saved. */
export function placements(
  saved: Record<string, string> | undefined,
): Record<EntryField, Placement> {
  return Object.fromEntries(
    ENTRY_FIELDS.map((f) => {
      const v = saved?.[f.id];
      return [f.id, v === "base" || v === "more" ? v : f.def];
    }),
  ) as Record<EntryField, Placement>;
}

/**
 * Pack fields into rows, in the sheet's order: a wide field alone, the others
 * two by two. A narrow field left without a partner has the row to itself.
 */
export function packRows(fields: EntryField[]): EntryField[][] {
  const wide = new Set(ENTRY_FIELDS.filter((f) => f.wide).map((f) => f.id));
  const ordered = ENTRY_FIELDS.map((f) => f.id).filter((id) => fields.includes(id));
  const rows: EntryField[][] = [];
  let pending: EntryField | null = null;
  for (const id of ordered) {
    if (wide.has(id)) {
      if (pending) rows.push([pending]);
      pending = null;
      rows.push([id]);
    } else if (pending) {
      rows.push([pending, id]);
      pending = null;
    } else {
      pending = id;
    }
  }
  if (pending) rows.push([pending]);
  return rows;
}

/** What a new entry's date starts as: today, or the date last saved. */
export type DateDefault = "today" | "last";

const LAST_DATE_KEY = "cb.entry.lastDate";

/** The date the last entry was saved with, if this browser remembers one. */
export function lastEntryDate(): string | null {
  try {
    const v = localStorage.getItem(LAST_DATE_KEY);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberEntryDate(date: string) {
  try {
    localStorage.setItem(LAST_DATE_KEY, date);
  } catch {
    // A convenience: without storage the default is simply today.
  }
}
