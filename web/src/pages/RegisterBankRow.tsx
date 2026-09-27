import { Button, Group, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconBuildingBank, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  ApiError,
  getTransactionReview,
  listBankConnections,
  syncBankConnection,
} from "../api/client";
import { showSyncResult, sinceNow } from "../bankSyncNotice";
import { notifications } from "@mantine/notifications";

/**
 * The account's line to its bank and to what wants reviewing, under the
 * register's header. Shown only when there is something to say.
 *
 * - When the account is linked to a bank connection (#504): when it last
 *   synced, and Sync, which fetches the whole connection — the other accounts
 *   it feeds come along, as they would from Settings.
 * - When the account has rows to review (#505): imported rows without a
 *   category, or possible duplicates. That is not tied to the bank: a file
 *   import and two hand-entered rows can need it just as well. The button
 *   opens Review on this account.
 */
export function RegisterBankRow({ walletId, accountId }: { walletId: number; accountId: number }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();

  const connections = useQuery({
    queryKey: ["bankConnections", walletId],
    queryFn: () => listBankConnections(walletId),
    enabled: walletId > 0,
  });
  const review = useQuery({
    queryKey: ["review", walletId],
    queryFn: () => getTransactionReview(walletId),
    enabled: walletId > 0,
  });

  const connection = (connections.data ?? []).find((c) =>
    (c.linkedAccountIds ?? []).includes(accountId),
  );
  const toReview =
    (review.data?.needsCategory ?? []).filter((r) => r.accountId === accountId).length +
    (review.data?.duplicates ?? []).filter(
      (p) => p.a.accountId === accountId || p.b.accountId === accountId,
    ).length;

  const sync = useMutation({
    mutationFn: () => syncBankConnection(walletId, connection!.id),
    onSuccess: (res) => {
      showSyncResult(res, t);
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
      void qc.invalidateQueries({ queryKey: ["bankConnections", walletId] });
      void qc.invalidateQueries({ queryKey: ["review", walletId] });
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  if (!connection && toReview === 0) return null;

  const last = connection?.lastSyncAt ?? connection?.lastSyncedAt;
  return (
    <Group gap="xs" wrap="nowrap" data-testid="register-bank-row">
      {connection && (
        <Tooltip label={connection.name || t("banksync.unnamed")} openDelay={300}>
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: "0 1 auto" }}>
            <IconBuildingBank size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
            <Text size="sm" c="dimmed" truncate>
              {last ? sinceNow(last, i18n.language) : t("banksync.neverSynced")}
            </Text>
          </Group>
        </Tooltip>
      )}
      <span style={{ flex: 1 }} />
      {connection && (
        <Button
          size="compact-sm"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          loading={sync.isPending}
          onClick={() => sync.mutate()}
        >
          {t("register.sync")}
        </Button>
      )}
      {toReview > 0 && (
        <Button
          size="compact-sm"
          variant="light"
          color="orange"
          leftSection={<IconAlertTriangle size={14} />}
          component={Link}
          to={`/review?account=${accountId}`}
        >
          {t("register.toReview", { count: toReview })}
        </Button>
      )}
    </Group>
  );
}
