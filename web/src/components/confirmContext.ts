import { createContext, useContext } from "react";

// The context and hook live apart from the provider component so that file
// exports only components — the same reason widgets/shared.ts holds their config
// types. It keeps React Fast Refresh working during development.

export interface ConfirmOptions {
  title: string;
  /** What will happen. Name the consequence; do not repeat the title. */
  body?: string;
  /** The verb for the action, e.g. "Delete". Never "OK". */
  confirmLabel?: string;
  /** The way out, e.g. "Keep them". Never a bare "Cancel" when a verb is clearer. */
  cancelLabel?: string;
  /** Destructive actions get the warning colour. */
  danger?: boolean;
}

export type Ask = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<Ask | null>(null);

/**
 * Ask the user to confirm something irreversible. Resolves true if they went
 * ahead, false on every other route out — button, Escape or the overlay.
 *
 *   if (await confirm({ title, body, confirmLabel, danger: true })) remove();
 */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm must be used inside ConfirmProvider");
  return ask;
}
