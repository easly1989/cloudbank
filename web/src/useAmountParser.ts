import { useCallback } from "react";

import { useAuth } from "./auth/AuthProvider";
import { parseAmountSmart, parseMinor } from "./money";

// useAmountParser returns the amount parser the current user has chosen. With
// the smart-amount-input preference on (the default), it parses leniently,
// accepting either "." or "," as the decimal separator (HomeBank-style);
// otherwise it parses strictly using the currency's configured decimal char.
// The returned function keeps parseMinor's signature so call sites are a drop-in
// swap: parse(input, fracDigits, decimalChar).
export function useAmountParser(): (
  input: string,
  fracDigits: number,
  decimalChar: string,
) => number | null {
  const { user } = useAuth();
  const smart = user?.preferences?.smartAmountInput ?? true;
  return useCallback(
    (input: string, fracDigits: number, decimalChar: string) =>
      smart ? parseAmountSmart(input, fracDigits) : parseMinor(input, fracDigits, decimalChar),
    [smart],
  );
}
