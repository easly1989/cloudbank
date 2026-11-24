import type { AccountType } from "../../api/client";

// A bank account's IBAN and BIC (#775). The server checks them the same way
// (internal/account/iban.go); here they guide the form before a save.

/** The account types that keep an IBAN in their number, and a BIC. */
export const isBankType = (t: AccountType) => t === "bank" || t === "checking" || t === "savings";

/** The electronic form: no spaces or dashes, upper case. */
export const compactCode = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

/** A number that starts like an IBAN (two letters, two digits) is checked as one. */
export const looksLikeIban = (s: string) => /^[A-Z]{2}[0-9]{2}/.test(compactCode(s));

/** ISO 13616: the right shape, and mod 97 of the rearranged digits is 1. */
export function validIban(s: string): boolean {
  const iban = compactCode(s);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  let rem = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    const v = ch >= "A" ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = (rem * (v >= 10 ? 100 : 10) + v) % 97;
  }
  return rem === 1;
}

/** A BIC has 8 or 11 letters and digits; empty is allowed. */
export const validBic = (s: string) =>
  s.trim() === "" || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compactCode(s));

/** The printed form, in groups of four, for reading it out or pasting it. */
export const groupIban = (s: string) => compactCode(s).replace(/(.{4})(?=.)/g, "$1 ");
