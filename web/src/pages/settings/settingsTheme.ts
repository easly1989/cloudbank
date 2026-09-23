// The settings screen's measurements, taken from the style tile.
//
// Read off the Settings board with docs/design/extract-spec.mjs. The board's
// point is structural before it is dimensional: settings is its own screen,
// with the app's navigation replaced by a rail of sections and one way back.
// See docs/design/settings.json.

/** The rail, which takes the sidebar's place and its width. */
export const RAIL = {
  width: 265,
  padY: 24,
  padX: 14,
  gap: 18,
  back: { fz: 13, fw: 400, gap: 7, inset: 8 },
  title: { fz: 20, fw: 700, inset: 8 },
  item: { height: 34, radius: 7, padY: 9, padX: 10, gap: 10, fz: 14, fw: 400, activeFw: 600 },
  badge: { fz: 11, fw: 600, radius: 9, padY: 1, padX: 7 },
} as const;

/** The section itself. */
export const SECTION = {
  title: { fz: 24, fw: 700 },
  hint: { fz: 14, fw: 400 },
  heading: { fz: 15, fw: 600 },
  headingHint: { fz: 13, fw: 400 },
  /** Between the title block and the first field, and between groups. */
  gap: 26,
} as const;

/** Fields, which the board draws wider and taller than Mantine's default. */
export const FIELD = {
  label: { fz: 13, fw: 600 },
  control: { height: 44, radius: 8, inset: 12, fz: 14 },
  /** A chip that turns something on, as in "balances above the register". */
  chip: { height: 38, radius: 8, inset: 14, fz: 13, fw: 500 },
  note: { fz: 12, fw: 400 },
} as const;
