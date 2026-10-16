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
  /**
   * What became of the mail (#657): "unverified" means a pattern would read it
   * but the sender was not authenticated; "duplicate" that the account
   * already has its transaction.
   */
  outcome: "unrecognized" | "unverified" | "created" | "duplicate" | "failed";
  /** Why it failed. */
  detail: string;
  authenticated: boolean;
  patternId: number | null;
  /** The transaction it made or duplicates, while it exists, and its account. */
  transactionId: number | null;
  accountId: number | null;
  /** That transaction's amount (minor units), memo and payee, as the register has them. */
  amount: number | null;
  memo: string | null;
  payee: string | null;
}

/** One mail with its text, for the pattern editor. */
export interface MailDetail extends MailSummary {
  body: string;
}

/** Sends one card's mails to its own account. */
export interface MailCardAccount {
  digits: string;
  accountId: number;
}

/**
 * How to read one kind of bank mail (#657): an RE2 expression with named
 * groups, matched against the subject, a newline and the body, and the fixed
 * values that complete the transaction.
 */
export interface MailPatternInput {
  name: string;
  sender: string;
  subjectMode: "" | "contains" | "regex";
  subject: string;
  body: string;
  accountId: number;
  cards: MailCardAccount[];
  direction: "out" | "in" | "capture";
  /** Comma-separated words that mean money in, for direction "capture". */
  inWords: string;
  paymentMode: number;
  applyRules: boolean;
  /** How the date group is written, e.g. DD.MM; "" without a date group. */
  dateFormat: string;
  /** Read only mails the sender's domain signed (DMARC or DKIM). */
  requireAuth: boolean;
  /** The editor's own state, opaque to the server. */
  editor: string;
}

export interface MailPattern extends MailPatternInput {
  id: number;
  mailboxId: number;
  position: number;
}

/** The transaction a mail becomes, before assignment rules. */
export interface MailExtracted {
  accountId: number;
  date: string;
  amount: number;
  memo: string;
  payee: string;
  info: string;
  category: string;
  tags: string[];
  paymentMode: number;
}

export interface MailPatternTest {
  matched: number;
  total: number;
  mails: {
    id: number;
    subject: string;
    receivedAt: string;
    authenticated: boolean;
    matched: boolean;
    transaction?: MailExtracted;
    error?: string;
  }[];
  /** Mails no pattern read that this one would. */
  retry: number;
}

export interface MailApplyResult {
  created: number;
  duplicate: number;
  failed: number;
}

export interface MailCheckResult {
  new: number;
  /** New mails that became transactions. */
  created: number;
  /** New mails no pattern read. */
  unrecognized: number;
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
  api.post<MailCheckResult>(`${base(walletId)}/mailboxes/${id}/check`);

export const listMailboxMessages = (walletId: number, id: number) =>
  api.get<MailSummary[]>(`${base(walletId)}/mailboxes/${id}/messages`);

export const getMailboxMessage = (walletId: number, id: number, messageId: number) =>
  api.get<MailDetail>(`${base(walletId)}/mailboxes/${id}/messages/${messageId}`);

const patterns = (walletId: number, id: number) => `${base(walletId)}/mailboxes/${id}/patterns`;

export const listMailPatterns = (walletId: number, id: number) =>
  api.get<MailPattern[]>(patterns(walletId, id));

export const createMailPattern = (walletId: number, id: number, p: MailPatternInput) =>
  api.post<MailPattern>(patterns(walletId, id), p);

export const updateMailPattern = (
  walletId: number,
  id: number,
  patternId: number,
  p: MailPatternInput,
) => api.put<MailPattern>(`${patterns(walletId, id)}/${patternId}`, p);

export const deleteMailPattern = (walletId: number, id: number, patternId: number) =>
  api.del<void>(`${patterns(walletId, id)}/${patternId}`);

export const reorderMailPatterns = (walletId: number, id: number, ids: number[]) =>
  api.put<MailPattern[]>(`${patterns(walletId, id)}/order`, { ids });

/** Tries a pattern, saved or not, on the sender's latest mails; writes nothing. */
export const testMailPattern = (walletId: number, id: number, p: MailPatternInput) =>
  api.post<MailPatternTest>(`${patterns(walletId, id)}/test`, p);

/** Runs a saved pattern over the mails that made no transaction yet. */
export const applyMailPattern = (walletId: number, id: number, patternId: number) =>
  api.post<MailApplyResult>(`${patterns(walletId, id)}/${patternId}/apply`);
