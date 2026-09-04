import { api } from "./core";
import type { CurrencyInfo } from "./structure";

// --- Bills (what's due, over scheduled outflows) ---

export type BillState = "overdue" | "due";

export interface Bill {
  scheduleId: number;
  templateId: number;
  name: string;
  accountId?: number | null;
  accountName?: string;
  /** The next occurrence's due date (YYYY-MM-DD). */
  dueDate: string;
  /** The most recent occurrence posted on or before today; empty if never paid. */
  lastPaid?: string;
  /** Signed minor units in the account's currency (negative for an outflow). */
  amount: number;
  /** Amount converted to the wallet's base currency. */
  baseAmount: number;
  currency: CurrencyInfo;
  state: BillState;
  isTransfer: boolean;
  autoPost: boolean;
}

export interface BillsSummary {
  from: string;
  to: string;
  baseCurrency: CurrencyInfo | null;
  bills: Bill[];
  /** Base-currency amount still to pay (positive magnitude of unpaid outflows). */
  totalDue: number;
  overdue: number;
  due: number;
  paid: number;
}

export const getBills = (walletId: number) =>
  api.get<BillsSummary>(`/api/v1/wallets/${walletId}/bills`);
