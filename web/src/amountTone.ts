// How an amount is coloured, in one place.
//
// Until the restyle, money was coloured inline as `c={amount < 0 ? "red" : "teal"}`
// in a dozen components. That made the accent carry two meanings at once: teal
// was both the brand colour and "money in", so changing the accent in Settings
// silently changed what an income figure looked like — and a red Donate button
// read as a warning.
//
// The restyle separates the two jobs. The accent means "you can act here" and
// nothing else, because each user can change it. Income and expense get their
// own fixed pair, defined as CSS custom properties in app.css so they follow the
// light/dark scheme without every caller knowing about it. They are deliberately
// darker and less saturated than any accent: an amount should read as a fact,
// not as an alarm.

/** The CSS colour for a signed amount in minor units, or undefined for zero. */
export function amountColor(minor: number): string | undefined {
  if (minor > 0) return "var(--cb-positive)";
  if (minor < 0) return "var(--cb-negative)";
  return undefined;
}

/**
 * Like amountColor, but leaves a positive amount in the default text colour.
 *
 * Balances and totals are the common case: a healthy balance is unremarkable
 * and does not need colouring, while a negative one is worth spotting. Colouring
 * every positive figure green turns the whole page into a traffic light.
 */
export function negativeOnlyColor(minor: number): string | undefined {
  return minor < 0 ? "var(--cb-negative)" : undefined;
}

/** The colour for something that needs the user's attention: overdue, over budget. */
export const attentionColor = "var(--cb-attention)";
