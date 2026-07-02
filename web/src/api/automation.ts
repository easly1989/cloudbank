import { api } from "./core";
import type { Split } from "./ledger";

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
  matchAccountId?: number | null;
  setPayeeId?: number | null;
  setCategoryId?: number | null;
  setPaymentMode?: number | null;
  setInfo?: string | null;
  applyOnManual: boolean;
  applyOnImport: boolean;
}

export interface AssignmentInput {
  matchField: MatchField;
  matchType: MatchType;
  pattern: string;
  caseSensitive?: boolean;
  matchAccountId?: number | null;
  setPayeeId?: number | null;
  setCategoryId?: number | null;
  setPaymentMode?: number | null;
  setInfo?: string | null;
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
  info?: string | null;
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

export const suggestAssignment = (walletId: number, memo: string, payee: string, accountId = 0) =>
  api.post<Suggestion>(`/api/v1/wallets/${walletId}/assignments/suggest`, {
    memo,
    payee,
    accountId,
  });
