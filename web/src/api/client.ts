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

// --- Auth, setup and admin ---

export interface User {
  id: number;
  username: string;
  email: string;
  isAdmin: boolean;
  locale: string;
  theme: string;
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
