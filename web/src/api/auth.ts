import { api, downloadFile } from "./core";

// --- Auth, setup and admin ---

export interface Preferences {
  dateFormat?: string;
  startScreen?: string;
  defaultAccountId?: number;
  /** Register column visibility, keyed by column id (payee/category/note/status/runningBalance). */
  registerColumns?: Record<string, boolean>;
  /** Register column order, by column id. Stale or missing ids are normalized on load. */
  registerColumnOrder?: string[];
  /** Register column widths in pixels, keyed by column id. Absent = the default width. */
  registerColumnWidths?: Record<string, number>;
  /** Which register column is sorted, and how. Absent = the ledger’s own chronological order. */
  registerSort?: { id: string; desc: boolean };
  /**
   * Where each field of the entry sheet sits: "base" or "more" (under More
   * details), keyed by field id. Absent keys take the defaults in
   * components/entryFields.ts.
   */
  entryFields?: Record<string, string>;
  /** What a new entry starts from: the date ("today" | "last") and the status code. */
  entryDefaults?: { date?: "today" | "last"; status?: number };
  /** HomeBank-style lenient amount entry (accept "." or "," as decimal). Default on. */
  smartAmountInput?: boolean;
  /** Collapse the desktop sidebar to an icon-only rail. */
  sidebarCollapsed?: boolean;
  /**
   * Which of the three balances to show — on the overview and above the
   * register, which are the same question asked in two places. Absent = today
   * alone; see pickBalances.
   */
  registerBalances?: string[];
  /** Accent (Mantine primary) colour name, e.g. "cloudbank", "teal". */
  themeAccent?: string;
  /**
   * Account ids whose balance is shown at the foot of the sidebar. Empty or
   * absent means the strip is off, which is the default: it is a glance, not a
   * second account list, so it is opt-in and capped at three (see
   * SIDEBAR_ACCOUNTS_MAX).
   */
  sidebarAccountIds?: number[];
  /** Sidebar nav order, by route id (e.g. "/accounts"). Legacy, superseded by navLayout. */
  navOrder?: string[];
  /** Pinned sidebar nav route ids. Legacy, superseded by navLayout. */
  navPinned?: string[];
  /**
   * Customizable sidebar navigation layout: ordered groups of items and
   * separators, with hidden flags and user-created groups. Normalized on load
   * (see components/navLayout.ts); the dashboard is pinned and the Settings
   * group is locked.
   */
  navLayout?: {
    version: number;
    groups: {
      id: string;
      labelKey?: string;
      label?: string;
      hidden?: boolean;
      locked?: boolean;
      entries: (
        { kind: "item"; to: string; hidden?: boolean } | { kind: "separator"; id: string }
      )[];
    }[];
  };
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
  /**
   * How far back the overview looks: a date preset, or absent for all time.
   * Widgets follow it unless they pin a period of their own.
   */
  dashboardPeriod?: string;
  /** Legacy: whether the one tour there used to be (the overview's) had run.
      Read only while toursSeen is absent; see onboarding/TourProvider. */
  tutorialSeen?: boolean;
  /** The page tours already offered, by id (onboarding/tours.ts). */
  toursSeen?: string[];
  /** Whether a page offers its tour the first time it is opened. Default on. */
  tourOffers?: boolean;
  /** Demo build: whether the notice about the demo has been read. */
  demoNoticeSeen?: boolean;
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

/** Public auth configuration: which login methods the login page should offer. */
export interface AuthConfig {
  oidc: { enabled: boolean; name: string };
}

export const getAuthConfig = () => api.get<AuthConfig>("/api/v1/auth/config");

export const postSetup = (body: Credentials) => api.post<User>("/api/v1/setup", body);

export const login = (body: Credentials) => api.post<LoginResult>("/api/v1/auth/login", body);

export const logout = () => api.post<void>("/api/v1/auth/logout");

/**
 * Demo build only: make a throwaway account with a year of made-up data and
 * sign in to it. The data is written in the language the reader has chosen.
 */
export const startDemo = (language: string) =>
  api.post<User>("/api/v1/demo/session", undefined, { "Accept-Language": language });

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
