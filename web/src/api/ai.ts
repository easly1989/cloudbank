import { api } from "./core";

// --- Opt-in AI (bring-your-own-key) ---

/** The AI's jobs, each switched on by itself under the master switch (#696). */
export interface AIFeatures {
  suggest: boolean;
  entry: boolean;
  mail: boolean;
  reports: boolean;
}

export type AIFeature = keyof AIFeatures;

/** The reports that come by themselves besides the monthly one (#697). */
export interface AISchedule {
  weekly: boolean;
  yearly: boolean;
}

export interface AISettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  features: AIFeatures;
  schedule: AISchedule;
  /** The wallets the AI must not work on. */
  walletsOff: number[];
  monthlyLimit: number;
  /** Calls this calendar month (UTC). */
  used: number;
  /** The colours flowing round the AI box. */
  motion: boolean;
  /** The provider is on the server's own network: nothing leaves it. */
  local: boolean;
}

export interface AISettingsInput {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /** Omit to keep the stored key; empty string clears it. */
  apiKey?: string;
  features?: AIFeatures;
  schedule?: AISchedule;
  walletsOff?: number[];
  monthlyLimit?: number;
  motion?: boolean;
}

export const AI_SETTINGS_KEY = ["aiSettings"] as const;

export const getAISettings = () => api.get<AISettings>("/api/v1/ai/settings");

export const updateAISettings = (body: AISettingsInput) =>
  api.put<AISettings>("/api/v1/ai/settings", body);

/** Whether the AI is ready to write reports: on, complete, and reports on. */
export const aiReportsOn = (s: AISettings | undefined) =>
  !!s && s.enabled && s.hasKey && s.baseUrl !== "" && s.model !== "" && s.features.reports;

/** One call to the model, as the log keeps it. */
export interface AISend {
  id: number;
  walletId: number | null;
  walletName: string;
  feature: AIFeature;
  model: string;
  createdAt: string;
  /** The text sent, word for word; only when one call is asked for. */
  sent?: string;
}

export const AI_SENDS_KEY = ["aiSends"] as const;

export const listAISends = (limit = 50) =>
  api.get<{ sends: AISend[] }>(`/api/v1/ai/sends?limit=${limit}`);

export const getAISend = (id: number) => api.get<AISend>(`/api/v1/ai/sends/${id}`);

export interface SuggestedCategory {
  id: number;
  name: string;
}

/** Only the payee and the amount go to the model, never the memo. */
export const suggestCategory = (
  walletId: number,
  body: { payee?: string; amount?: string; confirm?: boolean },
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
  tags?: string[];
}

export const parseEntry = (walletId: number, text: string, confirm = false) =>
  api.post<{ entry: ParsedEntry | null }>(`/api/v1/wallets/${walletId}/ai/parse-entry`, {
    text,
    confirm,
  });

// --- The AI's reports (#696) ---

export interface AIReportFigures {
  income: number;
  expense: number;
  net: number;
}

export interface AIReportCurrency {
  code: string;
  symbol: string;
  symbolPrefix: boolean;
  decimalChar: string;
  groupChar: string;
  fracDigits: number;
}

export type AIReportKind = "monthly" | "weekly" | "yearly";

/** The numbers the server computed; all the model was told. */
export interface AIReportBasis {
  kind: AIReportKind;
  /** YYYY-MM, the week's Monday YYYY-MM-DD, or YYYY. */
  period: string;
  currency: AIReportCurrency;
  figures: AIReportFigures;
  prev: AIReportFigures;
  avg: AIReportFigures;
  categories: { name: string; amount: number; prev: number; avg: number }[];
  largest: { date: string; payee: string; amount: number }[];
  overBudget: { name: string; budget: number; actual: number }[];
  bills: { name: string; date: string; amount: number }[];
}

export interface AIReport {
  id: number;
  kind: AIReportKind;
  period: string;
  /** Paragraphs separated by a blank line. */
  body: string;
  basis: AIReportBasis;
  model: string;
  feedback: -1 | 0 | 1;
  createdAt: string;
}

export const aiReportsKey = (walletId: number) => ["aiReports", walletId] as const;

export const listAIReports = (walletId: number) =>
  api.get<{ reports: AIReport[] }>(`/api/v1/wallets/${walletId}/insights/reports`);

export const generateAIReport = (walletId: number, period: string, confirm = false) =>
  api.post<AIReport>(`/api/v1/wallets/${walletId}/insights/reports`, { period, confirm });

export const setAIReportFeedback = (walletId: number, id: number, feedback: -1 | 0 | 1) =>
  api.put<void>(`/api/v1/wallets/${walletId}/insights/reports/${id}/feedback`, { feedback });
