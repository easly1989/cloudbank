import { api } from "./core";

// --- Wallets ---

export interface Wallet {
  id: number;
  title: string;
  ownerName: string;
  baseCurrencyId?: number | null;
  role: "owner" | "member";
  createdAt: string;
  /** Auto-post scheduled transactions up to N months ahead (0..3). */
  schedulePostMonths: number;
}

export interface WalletInput {
  title: string;
  ownerName?: string;
  baseCurrency?: string;
  schedulePostMonths?: number;
}

export const listWallets = () => api.get<Wallet[]>("/api/v1/wallets");

export const createWallet = (body: WalletInput) => api.post<Wallet>("/api/v1/wallets", body);

export const updateWallet = (id: number, body: WalletInput) =>
  api.patch<Wallet>(`/api/v1/wallets/${id}`, body);

export const deleteWallet = (id: number) => api.del<void>(`/api/v1/wallets/${id}`);

// --- Currencies ---

export interface CatalogEntry {
  code: string;
  name: string;
  symbol: string;
  fracDigits: number;
  symbolPrefix: boolean;
}

export interface Currency {
  id: number;
  isoCode: string;
  name: string;
  symbol: string;
  symbolPrefix: boolean;
  decimalChar: string;
  groupChar: string;
  fracDigits: number;
  isBase: boolean;
  rate: number;
  rateUpdatedAt?: string;
}

export interface CurrencyUpdate {
  rate?: number;
  symbol?: string;
  symbolPrefix?: boolean;
  decimalChar?: string;
  groupChar?: string;
  fracDigits?: number;
}

export const getCurrencyCatalog = () => api.get<CatalogEntry[]>("/api/v1/catalog/currencies");

export const listCurrencies = (walletId: number) =>
  api.get<Currency[]>(`/api/v1/wallets/${walletId}/currencies`);

export const addCurrency = (walletId: number, isoCode: string, makeBase = false) =>
  api.post<Currency>(`/api/v1/wallets/${walletId}/currencies`, { isoCode, makeBase });

export const updateCurrency = (walletId: number, currencyId: number, patch: CurrencyUpdate) =>
  api.patch<Currency>(`/api/v1/wallets/${walletId}/currencies/${currencyId}`, patch);

export const setBaseCurrency = (walletId: number, currencyId: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/currencies/${currencyId}/base`);

export const deleteCurrency = (walletId: number, currencyId: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/currencies/${currencyId}`);

export interface RateRefreshResult {
  date: string;
  updated: string[];
  unsupported: string[];
  providerError?: string;
}

export const refreshRates = (walletId: number) =>
  api.post<RateRefreshResult>(`/api/v1/wallets/${walletId}/currencies/refresh`);

// --- Accounts ---

export type AccountType =
  "bank" | "cash" | "checking" | "savings" | "creditcard" | "liability" | "asset" | "investment";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  currencyId: number;
  institution: string;
  number: string;
  initialBalance: number;
  minimumBalance: number;
  /** Today's balance: initial + transactions dated on/before today. */
  balance: number;
  /** Initial + all transactions, including future-dated. */
  futureBalance: number;
  closed: boolean;
  noSummary: boolean;
  noBudget: boolean;
  noReport: boolean;
  position: number;
  groupName: string;
  notes: string;
  website: string;
  /** HomeBank payment mode 0..11 pre-filled for new transactions in this account. */
  defaultPaymentMode: number;
  createdAt: string;
  currencyCode: string;
  currencySymbol: string;
  currencySymbolPrefix: boolean;
  currencyDecimalChar: string;
  currencyGroupChar: string;
  currencyFracDigits: number;
}

export interface AccountInput {
  name: string;
  type: AccountType;
  currencyId?: number;
  institution?: string;
  number?: string;
  initialBalance?: number;
  minimumBalance?: number;
  closed?: boolean;
  noSummary?: boolean;
  noBudget?: boolean;
  noReport?: boolean;
  groupName?: string;
  notes?: string;
  website?: string;
  defaultPaymentMode?: number;
}

export const listAccounts = (walletId: number) =>
  api.get<Account[]>(`/api/v1/wallets/${walletId}/accounts`);

export const createAccount = (walletId: number, body: AccountInput) =>
  api.post<Account>(`/api/v1/wallets/${walletId}/accounts`, body);

export const updateAccount = (walletId: number, accountId: number, body: AccountInput) =>
  api.patch<Account>(`/api/v1/wallets/${walletId}/accounts/${accountId}`, body);

export const deleteAccount = (walletId: number, accountId: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/accounts/${accountId}`);

// --- Categories ---

export interface Category {
  id: number;
  parentId?: number | null;
  name: string;
  isIncome: boolean;
  noBudget: boolean;
  noReport: boolean;
}

export interface CategoryInput {
  name: string;
  parentId?: number | null;
  isIncome?: boolean;
  noBudget?: boolean;
  noReport?: boolean;
}

export interface CategoryUsage {
  subcategories: number;
  payees: number;
  transactions: number;
}

export const listCategories = (walletId: number) =>
  api.get<Category[]>(`/api/v1/wallets/${walletId}/categories`);

export const createCategory = (walletId: number, body: CategoryInput) =>
  api.post<Category>(`/api/v1/wallets/${walletId}/categories`, body);

export const updateCategory = (walletId: number, id: number, body: CategoryInput) =>
  api.patch<Category>(`/api/v1/wallets/${walletId}/categories/${id}`, body);

export const deleteCategory = (walletId: number, id: number, reassignTo?: number) => {
  const q = reassignTo ? `?reassignTo=${reassignTo}` : "";
  return api.del<void>(`/api/v1/wallets/${walletId}/categories/${id}${q}`);
};

export const getCategoryUsage = (walletId: number, id: number) =>
  api.get<CategoryUsage>(`/api/v1/wallets/${walletId}/categories/${id}/usage`);

export const mergeCategory = (walletId: number, id: number, targetId: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/categories/${id}/merge`, { targetId });

// --- Payees ---

export interface Payee {
  id: number;
  name: string;
  defaultCategoryId?: number | null;
  defaultPaymentMode?: number | null;
}

export interface PayeeInput {
  name: string;
  defaultCategoryId?: number | null;
  defaultPaymentMode?: number | null;
}

export const listPayees = (walletId: number) =>
  api.get<Payee[]>(`/api/v1/wallets/${walletId}/payees`);

export const createPayee = (walletId: number, body: PayeeInput) =>
  api.post<Payee>(`/api/v1/wallets/${walletId}/payees`, body);

export const updatePayee = (walletId: number, id: number, body: PayeeInput) =>
  api.patch<Payee>(`/api/v1/wallets/${walletId}/payees/${id}`, body);

export const deletePayee = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/payees/${id}`);

export const mergePayee = (walletId: number, id: number, targetId: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/payees/${id}/merge`, { targetId });

export interface CurrencyInfo {
  code: string;
  symbol: string;
  symbolPrefix: boolean;
  decimalChar: string;
  groupChar: string;
  fracDigits: number;
}

// --- Vehicles ---

export interface Vehicle {
  id: number;
  name: string;
  plate: string;
  notes: string;
}

export interface VehicleInput {
  name: string;
  plate?: string;
  notes?: string;
}

export const listVehicles = (walletId: number) =>
  api.get<Vehicle[]>(`/api/v1/wallets/${walletId}/vehicles`);

export const createVehicle = (walletId: number, body: VehicleInput) =>
  api.post<Vehicle>(`/api/v1/wallets/${walletId}/vehicles`, body);

export const updateVehicle = (walletId: number, id: number, body: VehicleInput) =>
  api.patch<Vehicle>(`/api/v1/wallets/${walletId}/vehicles/${id}`, body);

export const deleteVehicle = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/vehicles/${id}`);
