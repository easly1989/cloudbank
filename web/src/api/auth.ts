import { api, downloadFile } from "./core";

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
  /** Dashboard widget layout: order, hidden ids, and per-widget width (full/half/third). */
  dashboardLayout?: { order: string[]; hidden: string[]; spans?: Record<string, string> };
  /** Whether the first-login onboarding tour has been seen (so it runs only once). */
  tutorialSeen?: boolean;
  /** Saved report configurations (Statistics/Trend), scoped per wallet + tab. */
  reportViews?: SavedReportView[];
}

/** A named, saved report configuration. `config` is the tab-specific state. */
export interface SavedReportView {
  id: string;
  walletId: number;
  tab: string;
  name: string;
  config: Record<string, unknown>;
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
