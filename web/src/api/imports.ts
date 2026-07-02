import { api, ApiError } from "./core";

// --- Imports ---

export interface ImportResult {
  walletId: number;
  counts: Record<string, number>;
  warnings: string[];
}

export type CSVDialect = "homebank" | "generic";
export type CSVDateFormat = "" | "iso" | "dmy" | "mdy";

export interface CSVPreviewRequest {
  accountId: number;
  content: string;
  dialect: CSVDialect;
  delimiter?: string;
  hasHeader?: boolean;
  dateFormat?: CSVDateFormat;
  decimalChar?: string;
  mapping?: Record<string, number>;
  applyRules?: boolean;
}

export interface CSVPreviewRow {
  line: number;
  include: boolean;
  duplicate: boolean;
  ruleApplied: boolean;
  error?: string;
  date: string;
  amount: number;
  paymentMode: number;
  info: string;
  payee: string;
  memo: string;
  category: string;
  tags: string[];
  importRef?: string;
}

export interface CSVPreview {
  columns: string[];
  rows: CSVPreviewRow[];
}

export interface CSVCommitRow {
  date: string;
  amount: number;
  paymentMode: number;
  info: string;
  payee: string;
  memo: string;
  category: string;
  tags: string[];
  importRef?: string;
}

// ParsedPreviewRequest is the body for the QIF and OFX previews (no column map).
export interface ParsedPreviewRequest {
  accountId: number;
  content: string;
  dateFormat?: CSVDateFormat;
  applyRules?: boolean;
}

// CSV field names used by the generic column mapping.
export const CSV_FIELDS = [
  "date",
  "amount",
  "payee",
  "memo",
  "category",
  "info",
  "paymode",
  "tags",
] as const;

export const previewCSV = (walletId: number, body: CSVPreviewRequest) =>
  api.post<CSVPreview>(`/api/v1/wallets/${walletId}/import/csv/preview`, body);

export const previewQIF = (walletId: number, body: ParsedPreviewRequest) =>
  api.post<CSVPreview>(`/api/v1/wallets/${walletId}/import/qif/preview`, body);

export const previewOFX = (walletId: number, body: ParsedPreviewRequest) =>
  api.post<CSVPreview>(`/api/v1/wallets/${walletId}/import/ofx/preview`, body);

export const commitImport = (walletId: number, accountId: number, rows: CSVCommitRow[]) =>
  api.post<{ created: number }>(`/api/v1/wallets/${walletId}/import/commit`, {
    accountId,
    rows,
  });

// downloadExport fetches an account's export (CSV or QIF) and saves it to a file
// via a temporary object URL.
export async function downloadExport(
  walletId: number,
  accountId: number,
  format: "csv" | "qif",
  filename: string,
): Promise<void> {
  const res = await fetch(`/api/v1/wallets/${walletId}/export/${format}?accountId=${accountId}`, {
    credentials: "same-origin",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// importXHB uploads the raw contents of a HomeBank .xhb file. It bypasses the
// JSON request wrapper because the body is the XML document itself.
export async function importXHB(file: File): Promise<ImportResult> {
  const res = await fetch("/api/v1/import/xhb", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/xml",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: file,
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
  return (await res.json()) as ImportResult;
}
