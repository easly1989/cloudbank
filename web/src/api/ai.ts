import { api } from "./core";

// --- Opt-in AI (bring-your-own-key) ---

/** The AI's jobs, each switched on by itself under the master switch (#696). */
export interface AIFeatures {
  suggest: boolean;
  entry: boolean;
  mail: boolean;
  reports: boolean;
  /** Budget proposals from what is really spent (#698). */
  budgets: boolean;
  /** Schedules raised, doubled or no longer paid (#699). */
  subscriptions: boolean;
  /** Categories that grew lately, back to what they were (#699). */
  savings: boolean;
  goals: boolean;
  /** Expenses out of scale, new payees, double charges (#700). */
  unusual: boolean;
  /** Payees always filed under one category, a rule each (#705). */
  rules: boolean;
  /** Payee names cleaned up and merged (#708). */
  payees: boolean;
  /** The column mapping of an unknown CSV (#709). */
  import: boolean;
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

export interface CategoryProposal {
  id: number;
  payeeId: number;
  /** Absent when the model proposed none for the payee. */
  categoryId?: number;
  source: "history" | "ai";
}

/** Review's proposals (#706): only the payee, the amount and the date go to the model. */
export const proposeCategories = (walletId: number, confirm = false) =>
  api.post<{ proposals: CategoryProposal[] }>(`/api/v1/wallets/${walletId}/ai/propose-categories`, {
    confirm,
  });

export interface CleanupPayee {
  id: number;
  name: string;
  transactions: number;
}

/** A clean name for some payees, the one that keeps its row first (#708). */
export interface CleanupProposal {
  name: string;
  /** A payee outside the group that already has the name. */
  targetId?: number;
  payees: CleanupPayee[];
  /** The text a "payee contains" rule would match; empty when none is long enough. */
  rule: string;
}

/** Only the payee names go to the model. */
export const proposePayeeCleanup = (walletId: number, confirm = false) =>
  api.post<{ groups: CleanupProposal[] }>(`/api/v1/wallets/${walletId}/ai/payee-cleanup`, {
    confirm,
  });

/** The model's reading of a generic CSV (#709); a field it could not tell is absent. */
export interface CSVProposal {
  mapping: Record<string, number>;
  dateFormat: "" | "iso" | "dmy" | "mdy";
  decimalChar: string;
  invertAmount: boolean;
}

/** The server reads the file's first rows; only their shapes go to the model. */
export const proposeCSVMapping = (
  walletId: number,
  file: { content: string; delimiter: string; hasHeader: boolean },
  confirm = false,
) => api.post<CSVProposal>(`/api/v1/wallets/${walletId}/ai/csv-mapping`, { ...file, confirm });

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

// --- Proposals (#698, #699) ---

export type AIProposalReason =
  | "none"
  | "over"
  | "under"
  | "raised"
  | "double"
  | "alike"
  | "unused"
  | "grown"
  | "late"
  | "move"
  | "eta"
  | "rule";

export type AIProposalKind = "budget" | "subscriptions" | "savings" | "goals" | "rules";

/**
 * One row, in positive minor units of the base currency: a category's proposed
 * monthly budget, or a schedule to look at (the budget fields are zero then).
 */
export interface AIProposalRow {
  categoryId: number;
  /** The category's path, Parent:Child; a schedule's name. */
  name: string;
  reason: AIProposalReason;
  /** Today's budget; 0 is none. */
  budget: number;
  median: number;
  /** The budget proposed; a raised schedule's latest payment. */
  proposed: number;
  /** What was spent each month, oldest first. */
  months: number[];
  hits: number;
  scheduleId?: number;
  /** What the schedule saves. */
  amount?: number;
  /** Raised: the last two payments, oldest first. */
  paid?: number[];
  /** Double, alike: the earlier schedule's name. */
  other?: string;
  /** Raised, unused: the last payment's date. */
  last?: string;
  /** What the schedule costs a year at the amount saved. */
  yearly?: number;
  /** Savings: the average a month in the nine months before, and lately. */
  before?: number;
  recent?: number;
  /** Goal: what is left, its pace a month lately, its date, and when the pace gets there. */
  goalId?: number;
  left?: number;
  pace?: number;
  date?: string;
  newDate?: string;
  /**
   * Rule: the payee (name is its name, categoryId the category proposed), the
   * category's path, and its transactions no rule decides: hits have that
   * category, without none.
   */
  payeeId?: number;
  category?: string;
  total?: number;
  without?: number;
}

export interface AIProposal {
  id: number;
  kind: AIProposalKind;
  period: string;
  body: string;
  basis: {
    months: string[];
    currency: AIReportCurrency;
    rows: AIProposalRow[];
    /** Goals: what the wallet kept a month in the last three full months. */
    kept?: number;
  };
  model: string;
  feedback: -1 | 0 | 1;
  createdAt: string;
}

export const aiProposalsKey = (walletId: number) => ["aiProposals", walletId] as const;

export const listAIProposals = (walletId: number) =>
  api.get<{ proposals: AIProposal[] }>(`/api/v1/wallets/${walletId}/insights/proposals`);

export const actOnAIProposal = (
  walletId: number,
  id: number,
  action: "later" | "ignore" | "applied",
  row?: { categoryId: number } | { scheduleId: number } | { goalId: number } | { payeeId: number },
) =>
  api.post<void>(`/api/v1/wallets/${walletId}/insights/proposals/${id}/actions`, {
    action,
    ...row,
  });

export const setAIProposalFeedback = (walletId: number, id: number, feedback: -1 | 0 | 1) =>
  api.put<void>(`/api/v1/wallets/${walletId}/insights/proposals/${id}/feedback`, { feedback });

// --- Unusual transactions (#700) ---

/** An expense flagged, the amount positive in its account's currency. */
export interface AIUnusualRow {
  id: number;
  transactionId: number;
  accountId: number;
  date: string;
  payee: string;
  amount: number;
  currency: AIReportCurrency;
  kind: "scale" | "new" | "double";
  /** Scale: the payee's median; new: the amount it is above. */
  usual: number;
  /** Scale: the payee's expenses in the year before. */
  payments: number;
  /** Double: the first charge. */
  otherId?: number;
  otherDate?: string;
}

export interface AIUnusual {
  /** The model's sentences; empty until it wrote some. */
  body: string;
  model: string;
  feedback: -1 | 0 | 1;
  createdAt: string;
  rows: AIUnusualRow[];
}

export const aiUnusualKey = (walletId: number) => ["aiUnusual", walletId] as const;

export const getAIUnusual = (walletId: number) =>
  api.get<AIUnusual>(`/api/v1/wallets/${walletId}/insights/unusual`);

export const setAIUnusualFine = (walletId: number, id: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/insights/unusual/${id}/fine`, {});

export const setAIUnusualFeedback = (walletId: number, feedback: -1 | 0 | 1) =>
  api.put<void>(`/api/v1/wallets/${walletId}/insights/unusual/feedback`, { feedback });
