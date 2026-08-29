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
  /**
   * Dashboard widget layout. Legacy shape ({ order, hidden, spans }) is migrated
   * on load into the free-form 2D model ({ version: 2, widgets: [...] }); see
   * components/dashboard/layout.ts.
   */
  dashboardLayout?:
    | { order: string[]; hidden: string[]; spans?: Record<string, string> }
    | {
        version: 2;
        widgets: { id: string; type: string; x: number; y: number; w: number; h: number }[];
      };
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
  twoFactorEnabled: boolean;
  createdAt: string;
}

export interface Credentials {
  username: string;
  email?: string;
  password: string;
  /** Second factor (TOTP or a recovery code); sent on the follow-up submit. */
  totpCode?: string;
}

/** Login returns the user, or a challenge when a second factor is required. */
export type LoginResult = User | { totpRequired: true };

export const isTotpChallenge = (r: LoginResult): r is { totpRequired: true } =>
  (r as { totpRequired?: boolean }).totpRequired === true;

export const getSetupStatus = () => api.get<{ needsSetup: boolean }>("/api/v1/setup/status");

export const postSetup = (body: Credentials) => api.post<User>("/api/v1/setup", body);

export const login = (body: Credentials) => api.post<LoginResult>("/api/v1/auth/login", body);

export const logout = () => api.post<void>("/api/v1/auth/logout");

export const getMe = () => api.get<User>("/api/v1/auth/me");

export const updateMe = (body: { locale?: string; theme?: string; preferences?: Preferences }) =>
  api.patch<User>("/api/v1/auth/me", body);

// --- Personal API tokens ---

export type ApiTokenScope = "read" | "write";

export interface ApiToken {
  id: string;
  name: string;
  scope: ApiTokenScope;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
}

export interface ApiTokenCreated {
  /** The plaintext token — returned once, never recoverable. */
  token: string;
  info: ApiToken;
}

export const listApiTokens = () => api.get<ApiToken[]>("/api/v1/auth/tokens");

export const createApiToken = (body: {
  name: string;
  scope: ApiTokenScope;
  expiresInDays?: number;
}) => api.post<ApiTokenCreated>("/api/v1/auth/tokens", body);

export const revokeApiToken = (id: string) => api.del<void>(`/api/v1/auth/tokens/${id}`);

// --- Two-factor authentication (TOTP) ---

export interface TotpSetup {
  secret: string;
  otpauthUri: string;
}

export const setup2fa = () => api.post<TotpSetup>("/api/v1/auth/2fa/setup");

export const enable2fa = (secret: string, code: string) =>
  api.post<{ recoveryCodes: string[] }>("/api/v1/auth/2fa/enable", { secret, code });

export const disable2fa = (password: string) =>
  api.post<void>("/api/v1/auth/2fa/disable", { password });

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
