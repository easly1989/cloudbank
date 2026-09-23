// The shell's measurements, taken from the style tile rather than guessed.
//
// Every number here was read off the Overview board with
// docs/design/extract-spec.mjs: the sidebar's width and padding, the wallet
// card, the pitch of the navigation, the foot. They live in one place so the
// components cite them instead of repeating them.
//
// See docs/design/overview.json for the source, and docs/design/README.md for
// why a screenshot is not enough.

/** The sidebar, open and as a rail. */
export const SIDEBAR_WIDTH = 265;
export const SIDEBAR_RAIL_WIDTH = 64;
/** Its own padding, and the space between its four blocks. */
export const SIDEBAR_PAD_Y = 20;
export const SIDEBAR_PAD_X = 14;
export const SIDEBAR_BLOCK_GAP = 22;

/** The product mark and its name. */
export const BRAND = { mark: 22, radius: 6, gap: 9, inset: 8, fz: 16, fw: 700 } as const;

/** The wallet card: label over name, with the balance on the same line. */
export const WALLET_CARD = {
  height: 55,
  radius: 9,
  padY: 10,
  padX: 12,
  gap: 2,
  label: { fz: 12, fw: 400 },
  name: { fz: 14, fw: 600 },
  balance: { fz: 13, fw: 400 },
} as const;

/**
 * Navigation.
 *
 * Items are 32 high on a 33px pitch — one pixel between them, not a gap you
 * could mistake for a group break, which is the 16 above.
 */
export const NAV = {
  groupGap: 16,
  itemGap: 1,
  label: { fz: 11, fw: 600, padding: "0 8px 6px" },
  item: { height: 32, radius: 7, inset: 8, gap: 10, fz: 14, fw: 400, activeFw: 600 },
} as const;

/** The foot: the support pill and the row that carries your name. */
export const FOOT = {
  padTop: 14,
  gap: 8,
  pill: { height: 38, radius: 999, inset: 16, fz: 13, fw: 600 },
  user: { height: 40, radius: 7, inset: 8, gap: 10, fz: 14 },
} as const;
