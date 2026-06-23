// Client-side money helpers mirroring the Go `money` package. Amounts are
// integer minor units; we never do float arithmetic on values.

export interface MoneyFormat {
  fracDigits: number;
  decimalChar: string;
  groupChar: string;
  symbol: string;
  symbolPrefix: boolean;
}

function pow10(n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r *= 10;
  return r;
}

function group(digits: string, groupChar: string): string {
  if (!groupChar || digits.length <= 3) return digits;
  const pre = digits.length % 3;
  const parts: string[] = [];
  if (pre > 0) parts.push(digits.slice(0, pre));
  for (let i = pre; i < digits.length; i += 3) parts.push(digits.slice(i, i + 3));
  return parts.join(groupChar);
}

/** Format minor units using the given currency metadata. */
export function formatMinor(amount: number, fmt: MoneyFormat): string {
  const frac = Math.max(0, fmt.fracDigits);
  const neg = amount < 0;
  const abs = Math.abs(amount);
  const scale = pow10(frac);
  const intPart = Math.floor(abs / scale);
  const fracPart = abs % scale;

  let num = group(String(intPart), fmt.groupChar);
  if (frac > 0) {
    num += (fmt.decimalChar || ".") + String(fracPart).padStart(frac, "0");
  }

  let out = neg ? "-" : "";
  if (fmt.symbol && fmt.symbolPrefix) out += fmt.symbol;
  out += num;
  if (fmt.symbol && !fmt.symbolPrefix) out += " " + fmt.symbol;
  return out;
}

/**
 * Parse a user-entered amount into integer minor units. Group separators,
 * symbols and spaces are ignored; decimalChar splits the fractional part. Extra
 * fractional digits are rounded half away from zero. Returns null on no digits.
 */
export function parseMinor(input: string, fracDigits: number, decimalChar: string): number | null {
  const s = input.trim();
  if (s === "") return null;
  const frac = Math.max(0, fracDigits);
  const neg = s.includes("-") || (s.startsWith("(") && s.endsWith(")"));
  const dc = decimalChar && decimalChar.length > 0 ? decimalChar[0] : ".";

  let intDigits = "";
  let fracDigitsStr = "";
  let seenDec = false;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") {
      if (seenDec) fracDigitsStr += ch;
      else intDigits += ch;
    } else if (ch === dc && !seenDec) {
      seenDec = true;
    }
  }
  if (intDigits === "" && fracDigitsStr === "") return null;

  let roundUp = false;
  if (fracDigitsStr.length > frac) {
    if (fracDigitsStr[frac] >= "5") roundUp = true;
    fracDigitsStr = fracDigitsStr.slice(0, frac);
  }
  fracDigitsStr = fracDigitsStr.padEnd(frac, "0");

  let total = Number(intDigits || "0") * pow10(frac) + Number(fracDigitsStr || "0");
  if (roundUp) total += 1;
  return neg ? -total : total;
}

/**
 * Parse a user-entered amount leniently, HomeBank-style: accept either "." or
 * "," as the decimal separator regardless of the currency's configured
 * separator. The **rightmost** "." or "," is treated as the decimal point and
 * any earlier separators are grouping (so "12.40", "12,40", "1.234,56" and
 * "1,234.56" all parse to the same value). Extra fractional digits are rounded
 * half away from zero. Returns null when there are no digits.
 */
export function parseAmountSmart(input: string, fracDigits: number): number | null {
  const s = input.trim();
  if (s === "") return null;
  const frac = Math.max(0, fracDigits);
  const neg = s.includes("-") || (s.startsWith("(") && s.endsWith(")"));

  // Keep only digits and the two candidate separators.
  let cleaned = "";
  for (const ch of s) {
    if ((ch >= "0" && ch <= "9") || ch === "." || ch === ",") cleaned += ch;
  }
  // With no fractional digits (e.g. JPY) there is no decimal part, so every
  // separator is grouping.
  let lastSep = -1;
  if (frac > 0) {
    for (let i = cleaned.length - 1; i >= 0; i--) {
      if (cleaned[i] === "." || cleaned[i] === ",") {
        lastSep = i;
        break;
      }
    }
  }
  const stripSeps = (x: string) => x.replace(/[.,]/g, "");
  const intDigits = stripSeps(lastSep < 0 ? cleaned : cleaned.slice(0, lastSep));
  let fracDigitsStr = lastSep < 0 ? "" : stripSeps(cleaned.slice(lastSep + 1));
  if (intDigits === "" && fracDigitsStr === "") return null;

  let roundUp = false;
  if (fracDigitsStr.length > frac) {
    if (fracDigitsStr[frac] >= "5") roundUp = true;
    fracDigitsStr = fracDigitsStr.slice(0, frac);
  }
  fracDigitsStr = fracDigitsStr.padEnd(frac, "0");

  let total = Number(intDigits || "0") * pow10(frac) + Number(fracDigitsStr || "0");
  if (roundUp) total += 1;
  return neg ? -total : total;
}
