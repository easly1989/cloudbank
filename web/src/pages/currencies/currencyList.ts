// The currencies page's model (#558): each currency with the accounts kept in
// it and where its rate came from, and the words the page writes a rate and a
// format with. Pure: no React.
import type { Account, Currency } from "../../api/client";
import { formatMinor, formatNumber, type MoneyFormat } from "../../money";

/** Where a currency's rate came from. */
export type RateOrigin = "base" | "ecb" | "manual" | "none";

export interface CurrencyRow {
  currency: Currency;
  /** How many accounts are kept in it: while any is, it cannot be deleted. */
  accounts: number;
  origin: RateOrigin;
}

export function originOf(c: Currency): RateOrigin {
  if (c.isBase) return "base";
  if (c.rateSource === "manual") return "manual";
  if (c.rateSource) return "ecb";
  return "none";
}

/** The base first, then by code, as the server lists them. */
export function buildRows(currencies: Currency[], accounts: Account[]): CurrencyRow[] {
  const count = new Map<number, number>();
  for (const a of accounts) count.set(a.currencyId, (count.get(a.currencyId) ?? 0) + 1);
  return [...currencies]
    .sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.isoCode.localeCompare(b.isoCode))
    .map((currency) => ({
      currency,
      accounts: count.get(currency.id) ?? 0,
      origin: originOf(currency),
    }));
}

/** A symbol set apart from the text around it, so a right-to-left one (the
    dirham's) does not turn "1 د.إ = 0,2331 €" round. */
export const isolate = (symbol: string) => (symbol ? `\u2068${symbol}\u2069` : "");

/** A currency's symbol, or its code when it has none, set apart. */
export const symbolOf = (c: Pick<Currency, "symbol" | "isoCode">) => isolate(c.symbol || c.isoCode);

/** How many decimals a rate is written with. */
export const RATE_DIGITS = 4;

/** "1 $ = 0,8807 €", with the base's separators. */
export function rateText(c: Currency, base: Currency): string {
  return `1 ${symbolOf(c)} = ${formatNumber(c.rate, RATE_DIGITS, base)} ${symbolOf(base)}`;
}

/** The other way round: "1 € = 1,1355 $". Empty for a rate of zero. */
export function inverseText(rate: number, c: Currency, base: Currency): string {
  if (!(rate > 0)) return "";
  return `1 ${symbolOf(base)} = ${formatNumber(1 / rate, RATE_DIGITS, base)} ${symbolOf(c)}`;
}

/** The latest ECB date among the wallet's rates, or null. */
export function latestEcbDate(rows: CurrencyRow[]): string | null {
  let out: string | null = null;
  for (const r of rows)
    if (r.origin === "ecb" && r.currency.rateDate && (!out || r.currency.rateDate > out))
      out = r.currency.rateDate;
  return out;
}

/** -1234.56 in a format, to preview it. */
export function preview(fmt: MoneyFormat): string {
  const digits = Math.max(0, fmt.fracDigits);
  let minor = 123456;
  if (digits > 2) minor *= 10 ** (digits - 2);
  else if (digits < 2) minor = Math.round(minor / 10 ** (2 - digits));
  return formatMinor(-minor, { ...fmt, symbol: isolate(fmt.symbol) });
}

/** Whether a format can write an amount: a decimal mark, and a thousands
    separator that is not the same, as the server checks. */
export const formatProblem = (fmt: MoneyFormat): "mark" | "same" | null =>
  !fmt.decimalChar ? "mark" : fmt.groupChar === fmt.decimalChar ? "same" : null;
