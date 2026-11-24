// The register's columns: which exist, what order they are in, and how the user
// moves them. Kept apart from the table component so the ordering rules can be
// tested without rendering a virtualised grid.

/**
 * Every data column, in the order the register ships with.
 *
 * `date` and `amount` are not in TOGGLEABLE — a ledger without a date or an
 * amount is not a ledger — but they can still be *moved*, which is why the
 * order list covers them and the visibility list does not.
 */
export const ALL_COLUMNS = [
  "date",
  "payee",
  "category",
  "note",
  "status",
  "amount",
  "runningBalance",
] as const;

export type ColumnId = (typeof ALL_COLUMNS)[number];

/**
 * Turn whatever order was saved into one the table can use.
 *
 * A saved order can be stale in three ways, and all three have to survive a
 * reload without the register losing a column: it can name a column that no
 * longer exists, repeat one, or predate a column added in a later release.
 * Unknown and duplicate ids are dropped; anything missing is appended in the
 * shipped order, so a new column shows up at its natural place rather than
 * vanishing.
 */
export function normalizeColumnOrder(saved: readonly string[] | undefined): ColumnId[] {
  const known = new Set<string>(ALL_COLUMNS);
  const seen = new Set<string>();
  const out: ColumnId[] = [];
  for (const id of saved ?? []) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id as ColumnId);
    }
  }
  for (const id of ALL_COLUMNS) if (!seen.has(id)) out.push(id);
  return out;
}

/**
 * The text columns, the ones that can take the register's free width. A date
 * or an amount has a natural width, and stretching it only moves the figures
 * away from their neighbours.
 */
export const GROW_COLUMNS: readonly string[] = ["payee", "category", "note"];

/**
 * The grid track of each visible column, and which of them takes the free width.
 *
 * Payee grows unless the user picked another text column (`chosen`, one per
 * user, every account). A choice counts only while its column is visible and
 * has no dragged width; otherwise Payee grows, as it always has. A chosen
 * column grows from the width it has when fixed, and Payee then holds at its
 * floor. A dragged width always wins, so a dragged Payee is fixed and nothing
 * grows, as before. `defaults` is ROW_COLUMNS, passed in to keep this file free
 * of the theme.
 */
export function columnTracks(
  visible: readonly string[],
  chosen: string | undefined,
  widths: Record<string, number>,
  defaults: Record<string, string>,
): { grow: string | null; tracks: string[] } {
  const picked =
    chosen && GROW_COLUMNS.includes(chosen) && visible.includes(chosen) && !widths[chosen]
      ? chosen
      : "payee";
  const grow = visible.includes(picked) && !widths[picked] ? picked : null;
  const floor = (track: string | undefined) => /(\d+)px/.exec(track ?? "")?.[1] ?? "100";
  const tracks = visible.map((id) => {
    if (widths[id]) return `${widths[id]}px`;
    if (id === grow) return `minmax(${floor(defaults[id])}px, 1fr)`;
    if (id === "payee") return `${floor(defaults.payee)}px`;
    return defaults[id] ?? "minmax(100px, 1fr)";
  });
  return { grow, tracks };
}

/**
 * Move one column one place left or right.
 *
 * Moving past either end is a no-op rather than a wrap: someone clicking "up"
 * repeatedly means "put this first", and wrapping it round to last would be a
 * surprise every time.
 */
export function moveColumn(order: readonly string[], id: string, delta: -1 | 1): ColumnId[] {
  const current = normalizeColumnOrder(order);
  const from = current.indexOf(id as ColumnId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= current.length) return current;
  const next = [...current];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
