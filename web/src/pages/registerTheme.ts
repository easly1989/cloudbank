// The register's measurements, taken from the style tile rather than guessed.
//
// Every number here was read off the Register and Dark boards with
// docs/design/extract-spec.mjs — grid template, band backgrounds, paddings,
// type sizes. They live in one place so the components cite them instead of
// repeating them, and so a change to the artefact lands in one file.
//
// See docs/design/register.json and docs/design/dark.json for the source, and
// docs/design/README.md for why a screenshot is not enough.

/** Grid template of a ledger row, before the checkbox column is prepended. */
export const ROW_COLUMNS: Record<string, string> = {
  date: "96px",
  payee: "240px",
  note: "240px",
  category: "156px",
  status: "140px",
  amount: "124px",
  runningBalance: "124px",
};

/** Width of the trailing cell that holds a row's own actions. */
export const ROW_ACTIONS_WIDTH = "84px";

/** Width of the leading checkbox cell. Not in the tile; see #449. */
export const ROW_SELECT_WIDTH = "34px";

/** Space between cells, and the inset of every band inside the ledger card. */
export const ROW_GAP = 12;
export const BAND_INSET = 18;

/** Vertical padding of each band, from the boards. */
export const BAND_PADDING = {
  hiddenNotice: 11,
  header: 10,
  newEntry: 12,
  row: 13,
  divider: 7,
  bulk: 12,
} as const;

/**
 * Type for the parts of a row, as `fontSize/fontWeight`.
 *
 * The lead text column carries the row at full size and the next one sits under
 * it, smaller and quieter — that is the rule the tile states in words and
 * proves in its own numbers.
 */
export const ROW_TYPE = {
  date: { fz: 13, fw: 400 },
  lead: { fz: 14, fw: 500 },
  subLine: { fz: 12, fw: 400 },
  category: { fz: 13, fw: 400 },
  amount: { fz: 14, fw: 500 },
  balance: { fz: 14, fw: 400 },
  header: { fz: 12, fw: 600 },
  divider: { fz: 11, fw: 600 },
  newEntry: { fz: 14, fw: 400 },
  bulkLabel: { fz: 14, fw: 600 },
  bulkSum: { fz: 15, fw: 600 },
} as const;

/** The dot beside a category name. */
export const CATEGORY_DOT = 9;

/** Height of the "reconciled up to here" divider row. */
export const DIVIDER_HEIGHT = 29;
