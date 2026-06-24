// Minimal fetch wrapper for the CloudBank JSON API. All requests are
// same-origin and send cookies (session auth, added in a later milestone).

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface Health {
  status: "ok" | "unhealthy";
  error?: string;
}

export const getHealth = () => api.get<Health>("/healthz");

export const getVersion = () => api.get<{ version: string }>("/api/v1/version");

// --- Auth, setup and admin ---

export interface Preferences {
  dateFormat?: string;
  startScreen?: string;
  defaultAccountId?: number;
  /** Register column visibility, keyed by column id (payee/category/note/status/runningBalance). */
  registerColumns?: Record<string, boolean>;
  /** HomeBank-style lenient amount entry (accept "." or "," as decimal). Default on. */
  smartAmountInput?: boolean;
  /** Collapse the desktop sidebar to an icon-only rail. */
  sidebarCollapsed?: boolean;
  /** Accent (Mantine primary) colour name, e.g. "teal", "blue". */
  themeAccent?: string;
  /** Sidebar nav order, by route id (e.g. "/accounts"). */
  navOrder?: string[];
  /** Pinned sidebar nav route ids; unpinned items fall into the "More" group. */
  navPinned?: string[];
  /** Dashboard widget layout: order of widget ids and the hidden ones. */
  dashboardLayout?: { order: string[]; hidden: string[] };
}

export interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
  locale: string;
  theme: string;
  preferences: Preferences;
  disabled: boolean;
  createdAt: string;
}

export interface Credentials {
  username: string;
  email?: string;
  password: string;
}

export const getSetupStatus = () => api.get<{ needsSetup: boolean }>("/api/v1/setup/status");

export const postSetup = (body: Credentials) => api.post<User>("/api/v1/setup", body);

export const login = (body: Credentials) => api.post<User>("/api/v1/auth/login", body);

export const logout = () => api.post<void>("/api/v1/auth/logout");

export const getMe = () => api.get<User>("/api/v1/auth/me");

export const updateMe = (body: { locale?: string; theme?: string; preferences?: Preferences }) =>
  api.patch<User>("/api/v1/auth/me", body);

// --- Integrity & backup ---

export interface IntegrityIssue {
  type: string;
  description: string;
  suggestion: string;
  count: number;
  ids: number[];
  fixable: boolean;
}

export const checkIntegrity = (walletId: number) =>
  api.get<{ issues: IntegrityIssue[] }>(`/api/v1/wallets/${walletId}/integrity`);

export const fixIntegrity = (walletId: number, type: string) =>
  api.post<{ fixed: number }>(`/api/v1/wallets/${walletId}/integrity/fix`, { type });

export const restoreBackup = (doc: unknown) =>
  api.post<{ walletId: number }>("/api/v1/backup/restore", doc);

async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const downloadWalletBackup = (walletId: number) =>
  downloadFile(`/api/v1/wallets/${walletId}/backup`, `wallet-${walletId}-backup.json`);

export const downloadWalletXHB = (walletId: number) =>
  downloadFile(`/api/v1/wallets/${walletId}/export/xhb`, `wallet-${walletId}.xhb`);

export const downloadHotBackup = () => downloadFile("/api/v1/admin/backup", "cloudbank-backup.db");

export const listUsers = () => api.get<User[]>("/api/v1/admin/users");

export interface CreateUserRequest {
  username: string;
  email?: string;
  password: string;
  isAdmin: boolean;
}

export const createUser = (body: CreateUserRequest) => api.post<User>("/api/v1/admin/users", body);

export const setUserDisabled = (id: number, disabled: boolean) =>
  api.post<void>(`/api/v1/admin/users/${id}/disable`, { disabled });

export const resetUserPassword = (id: number, password: string) =>
  api.post<void>(`/api/v1/admin/users/${id}/password`, { password });

// --- Wallets ---

export interface Wallet {
  id: number;
  title: string;
  ownerName: string;
  baseCurrencyId?: number | null;
  role: "owner" | "member";
  createdAt: string;
}

export interface WalletInput {
  title: string;
  ownerName?: string;
  baseCurrency?: string;
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
  | "bank"
  | "cash"
  | "checking"
  | "savings"
  | "creditcard"
  | "liability"
  | "asset"
  | "investment";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  currencyId: number;
  institution: string;
  number: string;
  initialBalance: number;
  minimumBalance: number;
  balance: number;
  closed: boolean;
  noSummary: boolean;
  noBudget: boolean;
  noReport: boolean;
  position: number;
  groupName: string;
  notes: string;
  website: string;
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
}

export interface CategoryInput {
  name: string;
  parentId?: number | null;
  isIncome?: boolean;
  noBudget?: boolean;
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

// --- Transactions ---

export interface Split {
  categoryId?: number | null;
  amount: number;
  memo?: string;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  paymentMode: number;
  status: number;
  info: string;
  payeeId?: number | null;
  categoryId?: number | null;
  memo: string;
  isSplit: boolean;
  tags: string[];
  splits?: Split[];
  payeeName?: string;
  categoryName?: string;
  transferId?: number | null;
  transferAccountId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  accountId: number;
  date: string;
  amount: number;
  paymentMode?: number;
  status?: number;
  info?: string;
  payeeId?: number | null;
  categoryId?: number | null;
  memo?: string;
  tags?: string[];
  splits?: Split[];
}

export interface TransactionPage {
  transactions: Transaction[];
  total: number;
}

export const listTransactions = (walletId: number, accountId: number, limit = 100, offset = 0) =>
  api.get<TransactionPage>(
    `/api/v1/wallets/${walletId}/transactions?accountId=${accountId}&limit=${limit}&offset=${offset}`,
  );

export const createTransaction = (walletId: number, body: TransactionInput) =>
  api.post<Transaction>(`/api/v1/wallets/${walletId}/transactions`, body);

export const getTransaction = (walletId: number, id: number) =>
  api.get<Transaction>(`/api/v1/wallets/${walletId}/transactions/${id}`);

export const updateTransaction = (walletId: number, id: number, body: TransactionInput) =>
  api.patch<Transaction>(`/api/v1/wallets/${walletId}/transactions/${id}`, body);

export const deleteTransaction = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/transactions/${id}`);

export const findDuplicateTransactions = (
  walletId: number,
  accountId: number,
  date: string,
  amount: number,
) =>
  api.get<Transaction[]>(
    `/api/v1/wallets/${walletId}/transactions/duplicates?accountId=${accountId}&date=${date}&amount=${amount}`,
  );

export const listTags = (walletId: number) => api.get<string[]>(`/api/v1/wallets/${walletId}/tags`);

// --- Register (account ledger with running balance) ---

export interface RegisterRow extends Transaction {
  runningBalance: number;
}

export interface RegisterSummary {
  bank: number;
  today: number;
  future: number;
}

export interface RegisterPage {
  rows: RegisterRow[];
  summary: RegisterSummary;
}

export const getRegister = (walletId: number, accountId: number) =>
  api.get<RegisterPage>(`/api/v1/wallets/${walletId}/transactions/register?accountId=${accountId}`);

export const setTransactionStatus = (walletId: number, id: number, status: number) =>
  api.patch<void>(`/api/v1/wallets/${walletId}/transactions/${id}/status`, { status });

export type BulkField = "status" | "category" | "payee" | "paymentMode";

export const bulkEditTransactions = (
  walletId: number,
  ids: number[],
  field: BulkField,
  value: number | null,
) =>
  api.post<{ updated: number }>(`/api/v1/wallets/${walletId}/transactions/bulk`, {
    ids,
    field,
    value,
  });

// --- Dashboard ---

export interface CurrencyInfo {
  code: string;
  symbol: string;
  symbolPrefix: boolean;
  decimalChar: string;
  groupChar: string;
  fracDigits: number;
}

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

// --- Templates ---

export interface Template {
  id: number;
  name: string;
  accountId?: number | null;
  amount: number;
  paymentMode: number;
  status: number;
  info: string;
  payeeId?: number | null;
  categoryId?: number | null;
  memo: string;
  tags: string[];
  isSplit: boolean;
  isTransfer: boolean;
  toAccountId?: number | null;
  splits?: Split[];
  createdAt: string;
}

export interface TemplateInput {
  name: string;
  accountId?: number | null;
  amount?: number;
  paymentMode?: number;
  status?: number;
  info?: string;
  payeeId?: number | null;
  categoryId?: number | null;
  memo?: string;
  tags?: string[];
  isTransfer?: boolean;
  toAccountId?: number | null;
  splits?: Split[];
}

export const listTemplates = (walletId: number) =>
  api.get<Template[]>(`/api/v1/wallets/${walletId}/templates`);

export const createTemplate = (walletId: number, body: TemplateInput) =>
  api.post<Template>(`/api/v1/wallets/${walletId}/templates`, body);

export const updateTemplate = (walletId: number, id: number, body: TemplateInput) =>
  api.patch<Template>(`/api/v1/wallets/${walletId}/templates/${id}`, body);

export const createTemplateFromTransaction = (
  walletId: number,
  transactionId: number,
  name: string,
) =>
  api.post<Template>(`/api/v1/wallets/${walletId}/templates/from-transaction/${transactionId}`, {
    name,
  });

export const deleteTemplate = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/templates/${id}`);

// --- Schedules ---

export type ScheduleUnit = "day" | "week" | "month" | "year";

export interface Schedule {
  id: number;
  templateId: number;
  templateName: string;
  templateAmount: number;
  templateIsTransfer: boolean;
  unit: ScheduleUnit;
  everyN: number;
  nextDue: string;
  weekendMode: number;
  remaining?: number | null;
  postAdvance: number;
  autoPost: boolean;
  lastPosted?: string;
}

export interface ScheduleInput {
  templateId: number;
  unit: ScheduleUnit;
  everyN: number;
  nextDue: string;
  weekendMode?: number;
  remaining?: number | null;
  postAdvance?: number;
  autoPost?: boolean;
}

export const listSchedules = (walletId: number) =>
  api.get<Schedule[]>(`/api/v1/wallets/${walletId}/schedules`);

export const listUpcomingSchedules = (walletId: number, before?: string) => {
  const q = before ? `?before=${before}` : "";
  return api.get<Schedule[]>(`/api/v1/wallets/${walletId}/schedules/upcoming${q}`);
};

export const createSchedule = (walletId: number, body: ScheduleInput) =>
  api.post<Schedule>(`/api/v1/wallets/${walletId}/schedules`, body);

export const updateSchedule = (walletId: number, id: number, body: ScheduleInput) =>
  api.patch<Schedule>(`/api/v1/wallets/${walletId}/schedules/${id}`, body);

export const deleteSchedule = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/schedules/${id}`);

export const postScheduleNow = (walletId: number, id: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/schedules/${id}/post`);

export const skipSchedule = (walletId: number, id: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/schedules/${id}/skip`);

// --- Transfers ---

export interface Transfer {
  id: number;
  fromAccountId: number;
  toAccountId: number;
  date: string;
  fromAmount: number;
  toAmount: number;
  memo: string;
  status: number;
  txnFromId: number;
  txnToId: number;
}

export interface TransferInput {
  fromAccountId: number;
  toAccountId: number;
  date: string;
  fromAmount: number;
  toAmount?: number;
  memo?: string;
  status?: number;
}

export const createTransfer = (walletId: number, body: TransferInput) =>
  api.post<Transfer>(`/api/v1/wallets/${walletId}/transfers`, body);

export const getTransfer = (walletId: number, id: number) =>
  api.get<Transfer>(`/api/v1/wallets/${walletId}/transfers/${id}`);

export const updateTransfer = (walletId: number, id: number, body: TransferInput) =>
  api.patch<Transfer>(`/api/v1/wallets/${walletId}/transfers/${id}`, body);

export const deleteTransfer = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/transfers/${id}`);

// --- Assignment rules ---

export type MatchField = "memo" | "payee" | "both";
export type MatchType = "exact" | "contains" | "regex";

export interface Assignment {
  id: number;
  position: number;
  matchField: MatchField;
  matchType: MatchType;
  pattern: string;
  caseSensitive: boolean;
  setPayeeId?: number | null;
  setCategoryId?: number | null;
  setPaymentMode?: number | null;
  applyOnManual: boolean;
  applyOnImport: boolean;
}

export interface AssignmentInput {
  matchField: MatchField;
  matchType: MatchType;
  pattern: string;
  caseSensitive?: boolean;
  setPayeeId?: number | null;
  setCategoryId?: number | null;
  setPaymentMode?: number | null;
  applyOnManual?: boolean;
  applyOnImport?: boolean;
}

export interface MatchedTransaction {
  id: number;
  accountId: number;
  date: string;
  memo: string;
  payeeName: string;
}

export interface Suggestion {
  matched: boolean;
  payeeId?: number | null;
  categoryId?: number | null;
  paymentMode?: number | null;
}

export const listAssignments = (walletId: number) =>
  api.get<Assignment[]>(`/api/v1/wallets/${walletId}/assignments`);

export const createAssignment = (walletId: number, body: AssignmentInput) =>
  api.post<Assignment>(`/api/v1/wallets/${walletId}/assignments`, body);

export const updateAssignment = (walletId: number, id: number, body: AssignmentInput) =>
  api.patch<Assignment>(`/api/v1/wallets/${walletId}/assignments/${id}`, body);

export const deleteAssignment = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/assignments/${id}`);

export const reorderAssignments = (walletId: number, ids: number[]) =>
  api.post<void>(`/api/v1/wallets/${walletId}/assignments/reorder`, { ids });

export const testAssignment = (walletId: number, body: AssignmentInput) =>
  api.post<MatchedTransaction[]>(`/api/v1/wallets/${walletId}/assignments/test`, body);

export const applyAssignments = (
  walletId: number,
  opts: { accountId?: number | null; onlyFillEmpty: boolean },
) => api.post<{ changed: number }>(`/api/v1/wallets/${walletId}/assignments/apply`, opts);

export const suggestAssignment = (walletId: number, memo: string, payee: string) =>
  api.post<Suggestion>(`/api/v1/wallets/${walletId}/assignments/suggest`, { memo, payee });

// --- Budgets ---

export type BudgetMode = "same" | "monthly";

export interface CategoryBudget {
  categoryId: number;
  mode: BudgetMode;
  same: number;
  monthly: number[];
}

export interface BudgetInput {
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

export const listBudgets = (walletId: number) =>
  api.get<CategoryBudget[]>(`/api/v1/wallets/${walletId}/budgets`);

export const setCategoryBudget = (walletId: number, categoryId: number, body: BudgetInput) =>
  api.put<void>(`/api/v1/wallets/${walletId}/budgets/${categoryId}`, body);

export const clearCategoryBudget = (walletId: number, categoryId: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/budgets/${categoryId}`);

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
  values: number[];
}

export interface BalanceResult {
  buckets: string[];
  series: BalanceSeries[];
  currency: CurrencyInfo | null;
}

export type ReportBucket = "day" | "week" | "month" | "quarter" | "year";
export type TrendBreakdown = "none" | "account" | "payee" | "category";

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
) => {
  const q = new URLSearchParams({ bucket });
  if (accountIds.length > 0) q.set("accountIds", accountIds.join(","));
  if (from) q.set("from", from);
  if (to) q.set("to", to);
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
  categoryId: number,
  from?: string,
  to?: string,
) => {
  const q = new URLSearchParams({ categoryId: String(categoryId) });
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return api.get<VehicleReport>(`/api/v1/wallets/${walletId}/reports/vehicle?${q.toString()}`);
};

// --- Imports ---

export interface ImportResult {
  walletId: number;
  counts: Record<string, number>;
  warnings: string[];
}

export type CSVDialect = "homebank" | "generic";
export type CSVDateFormat = "" | "iso" | "dmy" | "mdy";

export interface CSVPreviewRequest {
  accountId: number;
  content: string;
  dialect: CSVDialect;
  delimiter?: string;
  hasHeader?: boolean;
  dateFormat?: CSVDateFormat;
  decimalChar?: string;
  mapping?: Record<string, number>;
  applyRules?: boolean;
}

export interface CSVPreviewRow {
  line: number;
  include: boolean;
  duplicate: boolean;
  ruleApplied: boolean;
  error?: string;
  date: string;
  amount: number;
  paymentMode: number;
  info: string;
  payee: string;
  memo: string;
  category: string;
  tags: string[];
  importRef?: string;
}

export interface CSVPreview {
  columns: string[];
  rows: CSVPreviewRow[];
}

export interface CSVCommitRow {
  date: string;
  amount: number;
  paymentMode: number;
  info: string;
  payee: string;
  memo: string;
  category: string;
  tags: string[];
  importRef?: string;
}

// ParsedPreviewRequest is the body for the QIF and OFX previews (no column map).
export interface ParsedPreviewRequest {
  accountId: number;
  content: string;
  dateFormat?: CSVDateFormat;
  applyRules?: boolean;
}

// CSV field names used by the generic column mapping.
export const CSV_FIELDS = [
  "date",
  "amount",
  "payee",
  "memo",
  "category",
  "info",
  "paymode",
  "tags",
] as const;

export const previewCSV = (walletId: number, body: CSVPreviewRequest) =>
  api.post<CSVPreview>(`/api/v1/wallets/${walletId}/import/csv/preview`, body);

export const previewQIF = (walletId: number, body: ParsedPreviewRequest) =>
  api.post<CSVPreview>(`/api/v1/wallets/${walletId}/import/qif/preview`, body);

export const previewOFX = (walletId: number, body: ParsedPreviewRequest) =>
  api.post<CSVPreview>(`/api/v1/wallets/${walletId}/import/ofx/preview`, body);

export const commitImport = (walletId: number, accountId: number, rows: CSVCommitRow[]) =>
  api.post<{ created: number }>(`/api/v1/wallets/${walletId}/import/commit`, {
    accountId,
    rows,
  });

// downloadExport fetches an account's export (CSV or QIF) and saves it to a file
// via a temporary object URL.
export async function downloadExport(
  walletId: number,
  accountId: number,
  format: "csv" | "qif",
  filename: string,
): Promise<void> {
  const res = await fetch(`/api/v1/wallets/${walletId}/export/${format}?accountId=${accountId}`, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// importXHB uploads the raw contents of a HomeBank .xhb file. It bypasses the
// JSON request wrapper because the body is the XML document itself.
export async function importXHB(file: File): Promise<ImportResult> {
  const res = await fetch("/api/v1/import/xhb", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/xml",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: file,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body; keep statusText
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as ImportResult;
}
