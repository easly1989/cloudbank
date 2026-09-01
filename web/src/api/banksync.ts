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
