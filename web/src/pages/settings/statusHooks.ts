import { useQueries, useQuery } from "@tanstack/react-query";

import { getMailOverview, listBankConnections, listMailboxMessages } from "../../api/client";
import { useWallet } from "../../wallet/WalletProvider";
import { countMails } from "../mail/latestMails";

// How the open wallet's connections stand, for Settings › Home and
// Collegamenti (#800). The query keys are the pages' own, so the numbers and
// the pages share one fetch.

const MINUTE = 60_000;

export function useBankConnections() {
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const q = useQuery({
    queryKey: ["bankConnections", walletId],
    queryFn: () => listBankConnections(walletId),
    enabled: walletId > 0,
  });
  const list = q.data ?? [];
  const last = list
    .map((c) => c.lastSyncAt ?? c.lastSyncedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  return { loaded: q.isSuccess, count: list.length, last };
}

/** The bank mails: none in the demo, and none without CB_SECRET_KEY. */
export function useMailStatus() {
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const overview = useQuery({
    queryKey: ["mail", walletId],
    queryFn: () => getMailOverview(walletId),
    enabled: walletId > 0 && !__DEMO__,
    staleTime: MINUTE,
  });
  const mailboxes = overview.data?.available ? overview.data.mailboxes : [];
  const messages = useQueries({
    queries: mailboxes.map((m) => ({
      queryKey: ["mailMessages", walletId, m.id, m.lastMailAt],
      queryFn: () => listMailboxMessages(walletId, m.id),
      // Home and Connections are passed through often: a minute is fresh enough.
      staleTime: MINUTE,
    })),
  });
  const review = messages.reduce((n, q) => n + (q.data ? countMails(q.data).review : 0), 0);
  return {
    available: !__DEMO__ && !!overview.data?.available,
    mailboxes: mailboxes.length,
    review,
  };
}
