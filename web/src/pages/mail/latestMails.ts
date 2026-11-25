import type { MailSummary } from "../../api/client";

/** Which of a mailbox's latest mails show: those to review, those read, or all. */
export type MailFilter = "review" | "read" | "all";

/**
 * Read: the mail has a transaction, made now or already in the register. Every
 * other outcome made none, and is what a pattern saved later tries again.
 */
export const isRead = (m: Pick<MailSummary, "outcome">) =>
  m.outcome === "created" || m.outcome === "duplicate";

export function countMails(list: Pick<MailSummary, "outcome">[]) {
  const read = list.filter(isRead).length;
  return { read, review: list.length - read, all: list.length };
}

export function filterMails<T extends Pick<MailSummary, "outcome">>(list: T[], f: MailFilter) {
  if (f === "all") return list;
  return list.filter((m) => isRead(m) === (f === "read"));
}
