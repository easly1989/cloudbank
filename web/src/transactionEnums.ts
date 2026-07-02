// Shared HomeBank-compatible enumerations used across the transaction UI. The
// numeric values are the on-the-wire codes (see the Go `transaction` package);
// they are rendered through the `paymentModes.*` and `status.*` i18n keys.

/** Payment modes 0..11 (None, Credit card, Cheque, Cash, …) — HomeBank order. */
export const PAYMENT_MODES = Array.from({ length: 12 }, (_, i) => i);

/** Reconcile statuses 0..4 (None, Cleared, Reconciled, …). */
export const STATUSES = [0, 1, 2, 3, 4];
