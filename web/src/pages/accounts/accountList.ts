import type { Account, AccountType, Currency } from "../../api/client";
import type { MoneyFormat } from "../../money";

/** The account types, in the order the page groups them. */
export const ACCOUNT_TYPES: AccountType[] = [
  "bank",
  "checking",
  "savings",
  "cash",
  "creditcard",
  "liability",
  "asset",
  "investment",
];

/** Reconciled, today and future, in one currency. */
export interface Figures {
  reconciled: number;
  today: number;
  future: number;
}

export interface AccountGroup {
  type: AccountType;
  accounts: Account[];
  /** The group's figures in the base currency, without the accounts left out of the totals. */
  subtotal: Figures;
}

export interface AccountGroups {
  groups: AccountGroup[];
  /** Every shown account's figures in the base currency, the same ones left out. */
  total: Figures;
  /** How many accounts the total counts. */
  counted: number;
  /** Whether a figure was converted from another currency to reach the total. */
  converted: boolean;
}

/** An account's figures in its own currency. */
export const figuresOf = (a: Account): Figures => ({
  reconciled: a.reconciledBalance,
  today: a.balance,
  future: a.futureBalance,
});

/**
 * A minor-unit amount in one currency as base-currency minor units: its value
 * times the rate, rescaled for the two currencies' decimals. Display only, as
 * on the dashboard, so rounding to the nearest unit is enough.
 */
export function toBase(amount: number, from: Currency | undefined, base: Currency): number {
  if (!from || from.id === base.id) return amount;
  return Math.round(amount * from.rate * 10 ** (base.fracDigits - from.fracDigits));
}

/** Whether an account counts in the totals: open, and not left out of them. */
export const counts = (a: Account) => !a.closed && !a.noSummary;

/**
 * The page's groups (#564): one per account type, in ACCOUNT_TYPES order, each
 * with its subtotal, and the total under them. Closed accounts are shown only
 * when asked for and never counted; an account left out of the totals is
 * shown but not counted either.
 */
export function buildGroups(
  accounts: Account[],
  currencies: Currency[],
  showClosed: boolean,
): AccountGroups {
  const base = currencies.find((c) => c.isBase);
  const byId = new Map(currencies.map((c) => [c.id, c]));
  const zero = (): Figures => ({ reconciled: 0, today: 0, future: 0 });
  const total = zero();
  let counted = 0;
  let converted = false;
  const add = (into: Figures, a: Account) => {
    const f = figuresOf(a);
    const from = byId.get(a.currencyId);
    if (base && from && from.id !== base.id) converted = true;
    const conv = (n: number) => (base ? toBase(n, from, base) : n);
    into.reconciled += conv(f.reconciled);
    into.today += conv(f.today);
    into.future += conv(f.future);
  };
  const shown = accounts.filter((a) => showClosed || !a.closed);
  const groups = ACCOUNT_TYPES.map<AccountGroup>((type) => {
    const list = shown.filter((a) => a.type === type);
    const subtotal = zero();
    for (const a of list)
      if (counts(a)) {
        add(subtotal, a);
        add(total, a);
        counted++;
      }
    return { type, accounts: list, subtotal };
  }).filter((g) => g.accounts.length > 0);
  return { groups, total, counted, converted };
}

/**
 * Whether today's balance is under the account's minimum. A minimum of 0 is
 * none set: a credit card is below it by nature, and flagging every one says
 * nothing (#564).
 */
export const belowMinimum = (a: Account) => a.minimumBalance !== 0 && a.balance < a.minimumBalance;

/** Asset and investment accounts carry valuations. */
export const hasValuations = (a: Pick<Account, "type">) =>
  a.type === "asset" || a.type === "investment";

/** An account's money format. */
export const accountFormat = (a: Account): MoneyFormat => ({
  fracDigits: a.currencyFracDigits,
  decimalChar: a.currencyDecimalChar,
  groupChar: a.currencyGroupChar,
  symbol: a.currencySymbol,
  symbolPrefix: a.currencySymbolPrefix,
});
