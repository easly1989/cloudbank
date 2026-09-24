// The entry sheet's measurements, read off the Entering and deciding board
// (docs/design/entering-and-deciding.json) rather than guessed. See #469.

export const ENTRY_SHEET = {
  /** The sheet's width; its fields are this less 20px of padding each side. */
  width: 396,
  /** The wash over the ledger behind it: 4%, so the rows stay readable. */
  overlay: 0.04,
  /** The header's icon buttons, level with the close button. */
  headerButton: 34,
  /** Between one field and the next, and between the two of a pair. */
  gap: 14,
  pairGap: 10,
  /** The amount's sign switch, inside the field on its left. */
  sign: { section: 40 },
  /** The foot: its rule above, and the space between its buttons. */
  footTop: 12,
  footGap: 10,
  footButtonsGap: 8,
} as const;
