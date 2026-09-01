import { api } from "./core";

// --- Opt-in AI (bring-your-own-key) ---

export interface AISettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface AISettingsInput {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string;
}

export const getAISettings = () => api.get<AISettings>("/api/v1/ai/settings");

export const updateAISettings = (body: AISettingsInput) =>
  api.put<AISettings>("/api/v1/ai/settings", body);

export interface SuggestedCategory {
  id: number;
  name: string;
}

export const suggestCategory = (
  walletId: number,
  body: { payee?: string; memo?: string; amount?: string },
) =>
  api.post<{ category: SuggestedCategory | null }>(
    `/api/v1/wallets/${walletId}/ai/suggest-category`,
    body,
  );

export interface ParsedEntry {
  amount: string;
  direction: "expense" | "income";
  date: string;
  memo: string;
  payeeId?: number | null;
  payeeName?: string;
  categoryId?: number | null;
  categoryName?: string;
}

export const parseEntry = (walletId: number, text: string) =>
  api.post<{ entry: ParsedEntry | null }>(`/api/v1/wallets/${walletId}/ai/parse-entry`, { text });
