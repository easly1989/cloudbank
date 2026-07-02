import { api } from "./core";
import type { AccountType, CurrencyInfo } from "./structure";
import type { Schedule } from "./automation";

// --- Dashboard ---

export interface DashboardAccount {
  id: number;
  name: string;
  type: AccountType;
  groupName: string;
  closed: boolean;
  noSummary: boolean;
  bank: number;
  today: number;
  future: number;
  currency: CurrencyInfo;
  currencyId: number;
}

export interface CategorySlice {
  categoryId: number;
  name: string;
  amount: number;
}

export interface MonthPoint {
  month: string; // YYYY-MM
  income: number; // positive magnitude, base currency
  expense: number; // positive magnitude, base currency
}

export interface Dashboard {
  accounts: DashboardAccount[];
  totals: { bank: number; today: number; future: number };
  baseCurrency: CurrencyInfo | null;
  topCategories: CategorySlice[];
  incomeExpense: MonthPoint[];
  from: string;
  to: string;
  upcoming: Schedule[];
}

export type DashboardGroupBy = "category" | "payee";

export const getDashboard = (
  walletId: number,
  from?: string,
  to?: string,
  groupBy?: DashboardGroupBy,
  ieMonths?: number,
) => {
  const params = new URLSearchParams();
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  if (groupBy) params.set("groupBy", groupBy);
  if (ieMonths != null) params.set("ieMonths", String(ieMonths));
  const q = params.toString();
  return api.get<Dashboard>(`/api/v1/wallets/${walletId}/dashboard${q ? `?${q}` : ""}`);
};
