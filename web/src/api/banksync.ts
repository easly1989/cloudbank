import { api } from "./core";

// --- Automatic bank sync (SimpleFIN) ---

export interface BankConnection {
  id: number;
  provider: string;
  name: string;
  createdAt: string;
  lastSyncedAt?: string;
}

export interface BankRemoteAccount {
  externalId: string;
  name: string;
  currency: string;
  balance: string;
  linkedAccountId?: number | null;
}

export interface BankSyncResult {
  imported: number;
  reconciled: number;
  accounts: number;
}

export const listBankConnections = (walletId: number) =>
  api.get<BankConnection[]>(`/api/v1/wallets/${walletId}/bank/connections`);

export const connectBank = (walletId: number, setupToken: string, name: string) =>
  api.post<{ connection: BankConnection; accounts?: BankRemoteAccount[] }>(
    `/api/v1/wallets/${walletId}/bank/connections`,
    { setupToken, name },
  );

export const removeBankConnection = (walletId: number, connId: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/bank/connections/${connId}`);

export const listBankRemoteAccounts = (walletId: number, connId: number) =>
  api.get<BankRemoteAccount[]>(`/api/v1/wallets/${walletId}/bank/connections/${connId}/accounts`);

export const linkBankAccount = (
  walletId: number,
  connId: number,
  externalId: string,
  accountId: number,
) =>
  api.post<void>(`/api/v1/wallets/${walletId}/bank/connections/${connId}/links`, {
    externalId,
    accountId,
  });

export const unlinkBankAccount = (walletId: number, connId: number, externalId: string) =>
  api.del<void>(
    `/api/v1/wallets/${walletId}/bank/connections/${connId}/links/${encodeURIComponent(externalId)}`,
  );

export const syncBankConnection = (walletId: number, connId: number) =>
  api.post<BankSyncResult>(`/api/v1/wallets/${walletId}/bank/connections/${connId}/sync`);

// --- Enable Banking (EU/PSD2, bring-your-own credentials) ---

export interface EnableBankingConfig {
  configured: boolean;
  appId?: string;
  environment?: string;
}

export interface EnableBankingBank {
  name: string;
  country: string;
  logo?: string;
}

export const getEnableBankingConfig = (walletId: number) =>
  api.get<EnableBankingConfig>(`/api/v1/wallets/${walletId}/bank/enablebanking/config`);

export const setEnableBankingConfig = (
  walletId: number,
  input: { appId: string; privateKey: string; environment: string },
) => api.put<void>(`/api/v1/wallets/${walletId}/bank/enablebanking/config`, input);

export const deleteEnableBankingConfig = (walletId: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/bank/enablebanking/config`);

export const listEnableBankingBanks = (walletId: number, country?: string) =>
  api.get<EnableBankingBank[]>(
    `/api/v1/wallets/${walletId}/bank/enablebanking/aspsps${
      country ? `?country=${encodeURIComponent(country)}` : ""
    }`,
  );

export const startEnableBankingAuth = (
  walletId: number,
  input: { aspspName: string; aspspCountry: string; name: string; redirectUrl: string },
) =>
  api.post<{ url: string; state: string }>(
    `/api/v1/wallets/${walletId}/bank/enablebanking/auth`,
    input,
  );

export const completeEnableBankingAuth = (
  walletId: number,
  input: { state: string; code: string },
) =>
  api.post<{ connection: BankConnection }>(
    `/api/v1/wallets/${walletId}/bank/enablebanking/callback`,
    input,
  );
