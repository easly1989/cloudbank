import { api } from "./core";

// --- Bank mails (#654): the bank's notification mails, read from a mailbox ---

export interface Mailbox {
  id: number;
  provider: "microsoft" | "imap";
  address: string;
  paused: boolean;
  /**
   * "reauth" means the Microsoft sign-in has to be done again, or, for IMAP,
   * that the server refused the app password and needs a new one.
   */
  status: "ok" | "error" | "reauth";
  statusDetail: string;
  /** Last check of any source, RFC3339 UTC. */
  lastCheckAt: string | null;
  /** Arrival of the newest mail read, RFC3339 UTC. */
  lastMailAt: string | null;
  createdAt: string;
  /** Where an IMAP mailbox's server is; null for Microsoft. */
  imap: IMAPSettings | null;
  /** Whether whoever connected the mailbox has AI set up. */
  aiReady: boolean;
  /** Its sources (#794), in the order a mail is offered to them: 1 to 5. */
  sources: MailSource[];
}

/** A mailbox may read at most this many folders, each its own source. */
export const MAX_MAIL_SOURCES = 5;

/**
 * One folder of a mailbox (#794), with its own name, patterns and AI settings.
 * A mail two sources would read goes to the first in the mailbox's order.
 */
export interface MailSource {
  id: number;
  mailboxId: number;
  position: number;
  name: string;
  folder: string;
  /** How its mails are read, with the patterns, the AI or both (#659). */
  ai: MailSourceAI;
  /** "error": its folder cannot be read (gone or renamed). */
  status: "ok" | "error";
  statusDetail: string;
  /** Last check of its folder, RFC3339 UTC. */
  lastCheckAt: string | null;
  /**
   * How the server reads its folder now: "idle" (told about new mail),
   * "polling" (asks on a timer), "retry" (lost the connection, about to try
   * again), or "" when nothing listens.
   */
  mode: "idle" | "polling" | "retry" | "";
  /** The next full check, or the next attempt while retrying; RFC3339 UTC. */
  nextCheckAt: string | null;
}

/**
 * How a source uses the AI (#659): the order of patterns and AI, the account
 * what the AI reads goes to, the field its description fills, and the only
 * senders whose mails are sent to it.
 */
export interface MailSourceAI {
  mode: "patterns" | "patterns_ai" | "ai_patterns" | "ai";
  accountId: number | null;
  field: "memo" | "payee";
  senders: string[];
}

/** An IMAP mailbox's server and login name (#658); never its password. */
export interface IMAPSettings {
  host: string;
  port: number;
  /** "tls": encrypted from the first byte; "starttls": switches before the login. */
  security: "tls" | "starttls";
  username: string;
}

/**
 * What the IMAP connect form sends. A mailboxId gives that mailbox new
 * settings (a new app password) and keeps its folder and history.
 */
export interface IMAPMailboxInput extends Omit<IMAPSettings, "username"> {
  mailboxId?: number;
  address?: string;
  username?: string;
  password: string;
}

export interface MailOverview {
  /** False when the server has no CB_SECRET_KEY. */
  available: boolean;
  /** Whether Outlook.com mailboxes can be connected: also needs an application id. */
  microsoft: boolean;
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
  /** The AI, not a pattern, read the mail. */
  byAi: boolean;
  /** The source that read it, and its name; null once that source is removed. */
  sourceId: number | null;
  sourceName: string | null;
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
  sourceId: number;
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

export const connectIMAPMail = (walletId: number, input: IMAPMailboxInput) =>
  api.post<Mailbox>(`${base(walletId)}/imap`, input);

export const updateMailbox = (walletId: number, id: number, patch: { paused?: boolean }) =>
  api.patch<Mailbox>(`${base(walletId)}/mailboxes/${id}`, patch);

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

/** Where a source lives: its mailbox and its own id. */
export interface MailSourceRef {
  mailboxId: number;
  sourceId: number;
}

const sources = (walletId: number, mailboxId: number) =>
  `${base(walletId)}/mailboxes/${mailboxId}/sources`;
const source = (walletId: number, s: MailSourceRef) =>
  `${sources(walletId, s.mailboxId)}/${s.sourceId}`;

export const createMailSource = (
  walletId: number,
  mailboxId: number,
  input: { name: string; folder: string },
) => api.post<MailSource>(sources(walletId, mailboxId), input);

export const updateMailSource = (
  walletId: number,
  s: MailSourceRef,
  patch: { name?: string; folder?: string },
) => api.patch<MailSource>(source(walletId, s), patch);

export const updateMailSourceAI = (walletId: number, s: MailSourceRef, ai: MailSourceAI) =>
  api.put<MailSource>(`${source(walletId, s)}/ai`, ai);

export const deleteMailSource = (walletId: number, s: MailSourceRef) =>
  api.del<void>(source(walletId, s));

export const reorderMailSources = (walletId: number, mailboxId: number, ids: number[]) =>
  api.put<Mailbox>(`${sources(walletId, mailboxId)}/order`, { ids });

export const checkMailSource = (walletId: number, s: MailSourceRef) =>
  api.post<MailCheckResult>(`${source(walletId, s)}/check`);

const patterns = (walletId: number, s: MailSourceRef) => `${source(walletId, s)}/patterns`;

export const listMailPatterns = (walletId: number, s: MailSourceRef) =>
  api.get<MailPattern[]>(patterns(walletId, s));

export const createMailPattern = (walletId: number, s: MailSourceRef, p: MailPatternInput) =>
  api.post<MailPattern>(patterns(walletId, s), p);

export const updateMailPattern = (
  walletId: number,
  s: MailSourceRef,
  patternId: number,
  p: MailPatternInput,
) => api.put<MailPattern>(`${patterns(walletId, s)}/${patternId}`, p);

export const deleteMailPattern = (walletId: number, s: MailSourceRef, patternId: number) =>
  api.del<void>(`${patterns(walletId, s)}/${patternId}`);

export const reorderMailPatterns = (walletId: number, s: MailSourceRef, ids: number[]) =>
  api.put<MailPattern[]>(`${patterns(walletId, s)}/order`, { ids });

/** Tries a pattern, saved or not, on the sender's latest mails; writes nothing. */
export const testMailPattern = (walletId: number, s: MailSourceRef, p: MailPatternInput) =>
  api.post<MailPatternTest>(`${patterns(walletId, s)}/test`, p);

/** Runs a saved pattern over the mails of its folder that made no transaction yet. */
export const applyMailPattern = (walletId: number, s: MailSourceRef, patternId: number) =>
  api.post<MailApplyResult>(`${patterns(walletId, s)}/${patternId}/apply`);
