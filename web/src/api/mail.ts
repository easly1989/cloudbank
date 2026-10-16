import { api } from "./core";

// --- Bank mails (#654): the bank's notification mails, read from a mailbox ---

export interface Mailbox {
  id: number;
  provider: "microsoft";
  address: string;
  folder: string;
  paused: boolean;
  /** "reauth" means the Microsoft sign-in has to be done again. */
  status: "ok" | "error" | "reauth";
  statusDetail: string;
  /** Last check, RFC3339 UTC. */
  lastCheckAt: string | null;
  /** Arrival of the newest mail read, RFC3339 UTC. */
  lastMailAt: string | null;
  createdAt: string;
  /**
   * How the server reads the mailbox now: "idle" (told about new mail),
   * "polling" (asks on a timer), "retry" (lost the connection, about to try
   * again), or "" when nothing listens.
   */
  mode: "idle" | "polling" | "retry" | "";
  /** The next full check, or the next attempt while retrying; RFC3339 UTC. */
  nextCheckAt: string | null;
}

export interface MailOverview {
  /** False when the server has no CB_SECRET_KEY. */
  available: boolean;
  mailboxes: Mailbox[];
}

export interface MailSignIn {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  /** The code's lifetime in seconds. */
  expiresIn: number;
  /** Seconds between polls. */
  interval: number;
}

export interface MailSignInStatus {
  state: "pending" | "declined" | "expired" | "done";
  mailbox?: Mailbox;
}

export interface MailSummary {
  id: number;
  sender: string;
  subject: string;
  /** The mail's own Date header with its offset, RFC3339. */
  receivedAt: string;
  outcome: "unrecognized";
}

const base = (walletId: number) => `/api/v1/wallets/${walletId}/mail`;

export const getMailOverview = (walletId: number) => api.get<MailOverview>(base(walletId));

/** Starts a Microsoft sign-in; a mailboxId signs that mailbox in again. */
export const startMicrosoftMail = (walletId: number, mailboxId?: number) =>
  api.post<MailSignIn>(`${base(walletId)}/microsoft`, { mailboxId: mailboxId ?? 0 });

export const pollMicrosoftMail = (walletId: number, flowId: string) =>
  api.post<MailSignInStatus>(`${base(walletId)}/microsoft/${encodeURIComponent(flowId)}/poll`);

export const updateMailbox = (
  walletId: number,
  id: number,
  patch: { folder?: string; paused?: boolean },
) => api.patch<Mailbox>(`${base(walletId)}/mailboxes/${id}`, patch);

export const removeMailbox = (walletId: number, id: number) =>
  api.del<void>(`${base(walletId)}/mailboxes/${id}`);

export const listMailboxFolders = (walletId: number, id: number) =>
  api.get<{ folders: string[] }>(`${base(walletId)}/mailboxes/${id}/folders`);

export const checkMailbox = (walletId: number, id: number) =>
  api.post<{ new: number }>(`${base(walletId)}/mailboxes/${id}/check`);

export const listMailboxMessages = (walletId: number, id: number) =>
  api.get<MailSummary[]>(`${base(walletId)}/mailboxes/${id}/messages`);
