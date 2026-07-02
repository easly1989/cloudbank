import { api, ApiError } from "./core";

// --- Transactions ---

export interface Split {
  categoryId?: number | null;
  amount: number;
  memo?: string;
}

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amount: number;
  paymentMode: number;
  status: number;
  info: string;
  payeeId?: number | null;
  categoryId?: number | null;
  vehicleId?: number | null;
  memo: string;
  isSplit: boolean;
  tags: string[];
  splits?: Split[];
  payeeName?: string;
  categoryName?: string;
  transferId?: number | null;
  transferAccountId?: number | null;
  attachmentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionInput {
  accountId: number;
  date: string;
  amount: number;
  paymentMode?: number;
  status?: number;
  info?: string;
  payeeId?: number | null;
  categoryId?: number | null;
  vehicleId?: number | null;
  memo?: string;
  tags?: string[];
  splits?: Split[];
}

export interface TransactionPage {
  transactions: Transaction[];
  total: number;
}

export const listTransactions = (walletId: number, accountId: number, limit = 100, offset = 0) =>
  api.get<TransactionPage>(
    `/api/v1/wallets/${walletId}/transactions?accountId=${accountId}&limit=${limit}&offset=${offset}`,
  );

export const createTransaction = (walletId: number, body: TransactionInput) =>
  api.post<Transaction>(`/api/v1/wallets/${walletId}/transactions`, body);

export const getTransaction = (walletId: number, id: number) =>
  api.get<Transaction>(`/api/v1/wallets/${walletId}/transactions/${id}`);

export const updateTransaction = (walletId: number, id: number, body: TransactionInput) =>
  api.patch<Transaction>(`/api/v1/wallets/${walletId}/transactions/${id}`, body);

export const deleteTransaction = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/transactions/${id}`);

// --- Attachments ---

export interface Attachment {
  id: number;
  transactionId: number;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export const listAttachments = (walletId: number, transactionId: number) =>
  api.get<Attachment[]>(`/api/v1/wallets/${walletId}/attachments?transactionId=${transactionId}`);

// uploadAttachment posts a multipart form. It does not use the JSON `request`
// helper because the browser must set the multipart Content-Type/boundary.
export const uploadAttachment = async (
  walletId: number,
  transactionId: number,
  file: File,
): Promise<Attachment> => {
  const form = new FormData();
  form.append("transactionId", String(transactionId));
  form.append("file", file);
  const res = await fetch(`/api/v1/wallets/${walletId}/attachments`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    body: form,
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
  return (await res.json()) as Attachment;
};

export const deleteAttachment = (walletId: number, id: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/attachments/${id}`);

// attachmentUrl is the direct download/preview link (cookie-authenticated).
export const attachmentUrl = (walletId: number, id: number) =>
  `/api/v1/wallets/${walletId}/attachments/${id}`;

export const findDuplicateTransactions = (
  walletId: number,
  accountId: number,
  date: string,
  amount: number,
) =>
  api.get<Transaction[]>(
    `/api/v1/wallets/${walletId}/transactions/duplicates?accountId=${accountId}&date=${date}&amount=${amount}`,
  );

export const listTags = (walletId: number) => api.get<string[]>(`/api/v1/wallets/${walletId}/tags`);

export interface TagInfo {
  id: number;
  name: string;
  count: number;
}

export const listTagsWithCounts = (walletId: number) =>
  api.get<TagInfo[]>(`/api/v1/wallets/${walletId}/tags/manage`);

export const renameTag = (walletId: number, tagId: number, name: string) =>
  api.patch<void>(`/api/v1/wallets/${walletId}/tags/${tagId}`, { name });

export const mergeTag = (walletId: number, tagId: number, targetId: number) =>
  api.post<void>(`/api/v1/wallets/${walletId}/tags/${tagId}/merge`, { targetId });

export const deleteTag = (walletId: number, tagId: number) =>
  api.del<void>(`/api/v1/wallets/${walletId}/tags/${tagId}`);

// --- Register (account ledger with running balance) ---

export interface RegisterRow extends Transaction {
  runningBalance: number;
}

export interface RegisterSummary {
  bank: number;
  today: number;
  future: number;
}

export interface RegisterPage {
  rows: RegisterRow[];
  summary: RegisterSummary;
}

export const getRegister = (walletId: number, accountId: number) =>
  api.get<RegisterPage>(`/api/v1/wallets/${walletId}/transactions/register?accountId=${accountId}`);

export const setTransactionStatus = (walletId: number, id: number, status: number) =>
  api.patch<void>(`/api/v1/wallets/${walletId}/transactions/${id}/status`, { status });

export type BulkField = "status" | "category" | "payee" | "paymentMode";

export const bulkEditTransactions = (
  walletId: number,
  ids: number[],
  field: BulkField,
  value: number | null,
) =>
  api.post<{ updated: number }>(`/api/v1/wallets/${walletId}/transactions/bulk`, {
    ids,
    field,
    value,
  });
