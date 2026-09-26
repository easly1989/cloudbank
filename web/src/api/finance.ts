import { api } from "./core";
import type { CurrencyInfo } from "./structure";

// --- Budgets ---

export type BudgetMode = "same" | "monthly";

export interface CategoryBudget {
  categoryId: number;
  year: number;
  mode: BudgetMode;
  same: number;
  monthly: number[];
}

export interface BudgetInput {
  year?: number;
  mode: BudgetMode;
  same?: number;
  monthly?: number[];
}

export interface BudgetReportRow {
  categoryId: number;
  name: string;
  isIncome: boolean;
  budget: number;
  actual: number;
}

export interface BudgetReport {
  rows: BudgetReportRow[];
  totalBudget: number;
  totalActual: number;
  from: string;
  to: string;
  rollup: boolean;
  currency: CurrencyInfo | null;
}

export const listBudgets = (walletId: number, year = 0) =>
  api.get<CategoryBudget[]>(`/api/v1/wallets/${walletId}/budgets?year=${year}`);

export const setCategoryBudget = (walletId: number, categoryId: number, body: BudgetInput) =>
  api.put<void>(`/api/v1/wallets/${walletId}/budgets/${categoryId}`, body);

export const clearCategoryBudget = (walletId: number, categoryId: number, year = 0) =>
  api.del<void>(`/api/v1/wallets/${walletId}/budgets/${categoryId}?year=${year}`);

export const getBudgetReport = (walletId: number, from: string, to: string, rollup: boolean) =>
  api.get<BudgetReport>(
    `/api/v1/wallets/${walletId}/budgets/report?from=${from}&to=${to}&rollup=${rollup}`,
  );

// --- Reports ---

export type ReportGroupBy = "category" | "subcategory" | "payee" | "tag" | "month" | "year";

export interface StatisticsGroup {
  key: string;
  label: string;
  amount: number;
}

export interface StatisticsResult {
  groups: StatisticsGroup[];
  total: number;
  groupBy: string;
  currency: CurrencyInfo | null;
}

export interface ReportTransaction {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  memo: string;
  payeeName: string;
  categoryName: string;
}

const reportQuery = (params: Record<string, string>) => {
  const q = new URLSearchParams(params);
  return q.toString();
};

export const getStatistics = (
  walletId: number,
  groupBy: ReportGroupBy,
  params: Record<string, string>,
) =>
  api.get<StatisticsResult>(
    `/api/v1/wallets/${walletId}/reports/statistics?groupBy=${groupBy}&${reportQuery(params)}`,
  );

export const statisticsCsvUrl = (
  walletId: number,
  groupBy: ReportGroupBy,
  params: Record<string, string>,
) =>
  `/api/v1/wallets/${walletId}/reports/statistics?groupBy=${groupBy}&format=csv&${reportQuery(params)}`;

export const getStatisticsDrilldown = (
  walletId: number,
  groupBy: ReportGroupBy,
  groupKey: string,
  params: Record<string, string>,
) =>
  api.get<ReportTransaction[]>(
    `/api/v1/wallets/${walletId}/reports/statistics/drilldown?groupBy=${groupBy}&groupKey=${encodeURIComponent(groupKey)}&${reportQuery(params)}`,
  );

export interface TrendSeries {
  key: string;
  label: string;
  values: number[];
}

export interface TrendResult {
  buckets: string[];
  series: TrendSeries[];
  currency: CurrencyInfo | null;
}

export interface BalanceSeries {
  accountId: number;
  label: string;
  minimumBalance: number;
  /** The balance at the end of each bucket, in the account's own currency. */
  values: number[];
  currency: CurrencyInfo | null;
  /** The balance before the range's first day. */
  start: number;
  /** The balance at the end of asOf. */
  today: number;
  /** The lowest balance from the range's first day through asOf, on lowDate. */
  low: number;
  lowDate: string;
  /** The first day that ended under minimumBalance; "" when none did. */
  underMinimumOn: string;
}

export interface BalanceResult {
  buckets: string[];
  series: BalanceSeries[];
  /** The series summed per bucket, in the base currency. */
  total: number[];
  startTotal: number;
  todayTotal: number;
  asOf: string;
  currency: CurrencyInfo | null;
}

export type ReportBucket = "day" | "week" | "month" | "quarter" | "year";
export type TrendBreakdown = "none" | "account" | "payee" | "category" | "flow";

export const getTrend = (
  walletId: number,
  bucket: ReportBucket,
  breakdown: TrendBreakdown,
  params: Record<string, string>,
) =>
  api.get<TrendResult>(
    `/api/v1/wallets/${walletId}/reports/trend?bucket=${bucket}&breakdown=${breakdown}&${new URLSearchParams(params).toString()}`,
  );

export const getBalanceReport = (
  walletId: number,
  bucket: ReportBucket,
  accountIds: number[],
  from?: string,
  to?: string,
  /** The caller's today, and whether to add what the schedules will do after it. */
  opts: { asOf?: string; scheduled?: boolean } = {},
) => {
  const q = new URLSearchParams({ bucket });
  if (accountIds.length > 0) q.set("accountIds", accountIds.join(","));
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  if (opts.asOf) q.set("asOf", opts.asOf);
  if (opts.scheduled) q.set("scheduled", "1");
  return api.get<BalanceResult>(`/api/v1/wallets/${walletId}/reports/balance?${q.toString()}`);
};

export interface VehicleEntry {
  transactionId: number;
  date: string;
  meter: number;
  distance: number;
  volume: number;
  price: number;
  cost: number;
  partial: boolean;
  consumption: number;
}

export interface VehicleReport {
  entries: VehicleEntry[];
  totalDistance: number;
  totalVolume: number;
  totalCost: number;
  avgConsumption: number;
  currency: CurrencyInfo | null;
}

export const getVehicleReport = (
  walletId: number,
  vehicleId: number,
  from?: string,
  to?: string,
) => {
  const q = new URLSearchParams({ vehicleId: String(vehicleId) });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return api.get<VehicleReport>(`/api/v1/wallets/${walletId}/reports/vehicle?${q.toString()}`);
};

// --- Uncleared / reconciliation summary ---

export interface UnclearedAccount {
  accountId: number;
  accountName: string;
  count: number;
  amount: number;
  currency: CurrencyInfo;
}

export interface UnclearedReport {
  accounts: UnclearedAccount[];
}

export const getUnclearedReport = (walletId: number) =>
  api.get<UnclearedReport>(`/api/v1/wallets/${walletId}/reports/uncleared`);

// --- Cashflow forecast ---

export interface CashflowResult {
  dates: string[];
  balances: number[];
  minimum: number;
  currency: CurrencyInfo | null;
}

export const getCashflowForecast = (walletId: number, accountId: number, days = 90) =>
  api.get<CashflowResult>(
    `/api/v1/wallets/${walletId}/reports/cashflow?accountId=${accountId}&days=${days}`,
  );
