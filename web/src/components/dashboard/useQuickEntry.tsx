import { useDisclosure } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { listAccounts, listTemplates } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { TransactionForm } from "../TransactionForm";

/**
 * The entry sheet opened from the overview, without leaving it: by the header's
 * Add transaction (#624) and by the Add transaction widget. It starts on the
 * default account (Settings › General), or the first open one, and the sheet's
 * own Account field changes it. A save refreshes the overview's figures.
 */
export function useQuickEntry(walletId: number) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [opened, sheet] = useDisclosure(false);
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => !a.closed),
    [accountsQuery.data],
  );
  // Which account the reader picked, if they have picked one. The default is
  // derived rather than stored: storing it needed an effect that ran after the
  // accounts arrived, which cost a render and left a frame with nothing
  // selected. Derived, it is simply right from the first paint, and it follows
  // the list if the accounts load late.
  const [picked, setPicked] = useState<string | null>(null);
  const preferred = user?.preferences?.defaultAccountId;
  const fallback = accounts.length
    ? String(preferred && accounts.some((a) => a.id === preferred) ? preferred : accounts[0].id)
    : null;
  const accountId = picked ?? fallback;
  const account = accounts.find((a) => String(a.id) === accountId);

  // Refresh only — the form closes itself via onClose on a plain save, and stays
  // open (with the fields kept) on "Save & keep".
  const onSaved = () => {
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
  };

  const form = account && (
    <TransactionForm
      opened={opened}
      onClose={sheet.close}
      walletId={walletId}
      account={account}
      editing={null}
      onSaved={onSaved}
      templates={templatesQuery.data ?? []}
      onTemplateSaved={() => void qc.invalidateQueries({ queryKey: ["templates", walletId] })}
    />
  );

  return { accounts, accountId, account, pick: setPicked, open: sheet.open, form };
}
