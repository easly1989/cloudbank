import { api } from "./core";
import type { CurrencyInfo } from "./structure";

// --- Bills (what's due, over scheduled outflows) ---

export type BillState = "overdue" | "due" | "paid";

export interface Bill {
  scheduleId: number;
  templateId: number;
  name: string;
  accountId?: number | null;
  accountName?: string;
  dueDate: string;
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

export const getBills = (walletId: number, from?: string, to?: string) => {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const q = params.toString();
  return api.get<BillsSummary>(`/api/v1/wallets/${walletId}/bills${q ? `?${q}` : ""}`);
};
