// The overview's measurements, taken from the style tile rather than guessed.
//
// Read off the Overview board with docs/design/extract-spec.mjs: the period
// switch, the row of figures, the attention card and the pitch of the widget
// grid. See docs/design/overview.json for the source.
//
// One number is deliberately not here. The board sets its page title at 30/700,
// while the secondary-pages board sets its own at 26/700 and the register board
// at 24/700 — three boards, three sizes. The app is at 26/700, which matches two
// of them, and that is the size we settled on: every page keeps one title size
// rather than this one becoming an exception. Decided on #449, not an oversight.

/** The period switch: a track with one pill lit. */
export const PERIOD_SWITCH = {
  height: 44,
  radius: 9,
  pad: 4,
  gap: 4,
  item: { height: 36, radius: 7, padY: 8, padX: 13, fz: 13, fw: 500, activeFw: 600 },
} as const;

/**
 * The figures at the head of the page.
 *
 * Fifty-two pixels apart, which is wide — the balance has to read as the
 * subject and the rest as its explanation, and that only works if there is
 * real air between them.
 */
export const FIGURES = {
  padY: 24,
  gap: 52,
  labelGap: 6,
  label: { fz: 13, fw: 400 },
  headline: { fz: 40, fw: 600 },
  secondary: { fz: 24, fw: 500 },
  /** Secondary figures sit six pixels lower, so their labels align. */
  secondaryOffset: 6,
} as const;

/** The card that lists what wants doing. */
export const ATTENTION = {
  radius: 10,
  padY: 16,
  padX: 20,
  gap: 11,
  listGap: 9,
  rowGap: 12,
  title: { fz: 14, fw: 600 },
  count: { fz: 14, fw: 600, width: 26 },
  text: { fz: 14, fw: 400 },
  action: { fz: 14, fw: 600 },
} as const;

/** The widget grid below them. */
export const WIDGETS = {
  padTop: 22,
  columnGap: 56,
  headingGap: 16,
  heading: { fz: 15, fw: 600 },
  hint: { fz: 12, fw: 400 },
} as const;
