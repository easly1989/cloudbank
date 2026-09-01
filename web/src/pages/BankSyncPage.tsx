import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBuildingBank, IconPlus, IconRefreshDot, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type BankConnection,
  connectBank,
  linkBankAccount,
  listAccounts,
  listBankConnections,
  listBankRemoteAccounts,
  removeBankConnection,
  syncBankConnection,
  unlinkBankAccount,
} from "../api/client";
import { useDateFormat } from "../dates";
import { useWallet } from "../wallet/WalletProvider";

export function BankSyncPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const connections = useQuery({
    queryKey: ["bankConnections", walletId],
    queryFn: () => listBankConnections(walletId),
    enabled: walletId > 0,
  });

  if (!currentWallet) return null;

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{t("banksync.title")}</Title>
          <Text c="dimmed" size="sm" maw={680}>
            {t("banksync.hint")}
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>
          {t("banksync.connect")}
        </Button>
      </Group>

      {(connections.data ?? []).length === 0 ? (
        <Card withBorder>
          <Text c="dimmed">{t("banksync.empty")}</Text>
        </Card>
      ) : (
        <Stack>
          {(connections.data ?? []).map((c) => (
            <ConnectionCard key={c.id} walletId={walletId} connection={c} />
          ))}
        </Stack>
      )}

      <ConnectModal
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        walletId={walletId}
        onDone={() => void qc.invalidateQueries({ queryKey: ["bankConnections", walletId] })}
      />
    </Stack>
  );
}

function ConnectionCard({
  walletId,
  connection,
}: {
  walletId: number;
  connection: BankConnection;
}) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const remote = useQuery({
    queryKey: ["bankRemote", walletId, connection.id],
    queryFn: () => listBankRemoteAccounts(walletId, connection.id),
    enabled: walletId > 0,
  });

  const refreshConns = () => void qc.invalidateQueries({ queryKey: ["bankConnections", walletId] });

  const sync = useMutation({
    mutationFn: () => syncBankConnection(walletId, connection.id),
    onSuccess: (res) => {
      notifications.show({
        color: "teal",
        message: t("banksync.synced", { imported: res.imported, reconciled: res.reconciled }),
      });
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
      void qc.invalidateQueries({ queryKey: ["bankRemote", walletId, connection.id] });
      refreshConns();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => removeBankConnection(walletId, connection.id),
    onSuccess: refreshConns,
    onError,
  });
  const link = useMutation({
    mutationFn: (v: { externalId: string; accountId: number | null }) =>
      v.accountId
        ? linkBankAccount(walletId, connection.id, v.externalId, v.accountId)
        : unlinkBankAccount(walletId, connection.id, v.externalId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["bankRemote", walletId, connection.id] }),
    onError,
  });

  const accountOptions = (accountsQuery.data ?? []).map((a) => ({
    value: String(a.id),
    label: a.name,
  }));

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start" mb="sm">
        <Group gap="xs">
          <IconBuildingBank size={18} />
          <div>
            <Text fw={600}>{connection.name || t("banksync.unnamed")}</Text>
            <Text size="xs" c="dimmed">
              {connection.provider} ·{" "}
              {connection.lastSyncedAt
                ? t("banksync.lastSynced", { date: fmtDate(connection.lastSyncedAt) })
                : t("banksync.neverSynced")}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <Button
            variant="light"
            leftSection={<IconRefreshDot size={16} />}
            loading={sync.isPending}
            onClick={() => sync.mutate()}
          >
            {t("banksync.syncNow")}
          </Button>
          <Tooltip label={t("banksync.remove")} withArrow>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={t("banksync.remove")}
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(t("banksync.confirmRemove", { name: connection.name })))
                  remove.mutate();
              }}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {remote.isError ? (
        <Alert color="red">{t("banksync.remoteError")}</Alert>
      ) : (
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            {t("banksync.accounts")}
          </Text>
          {(remote.data ?? []).length === 0 ? (
            <Text c="dimmed" size="sm">
              {t("banksync.noRemote")}
            </Text>
          ) : (
            (remote.data ?? []).map((ra) => (
              <Group key={ra.externalId} justify="space-between" wrap="nowrap" gap="sm">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" truncate>
                    {ra.name}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {ra.balance} {ra.currency}
                  </Text>
                </div>
                <Group gap="xs" wrap="nowrap">
                  {ra.linkedAccountId ? (
                    <Badge size="sm" color="teal" variant="light">
                      {t("banksync.linked")}
                    </Badge>
                  ) : (
                    <Badge size="sm" color="gray" variant="light">
                      {t("banksync.notLinked")}
                    </Badge>
                  )}
                  <Select
                    placeholder={t("banksync.linkTo")}
                    data={accountOptions}
                    value={ra.linkedAccountId ? String(ra.linkedAccountId) : null}
                    onChange={(v) =>
                      link.mutate({ externalId: ra.externalId, accountId: v ? Number(v) : null })
                    }
                    clearable
                    w={200}
                  />
                </Group>
              </Group>
            ))
          )}
        </Stack>
      )}
    </Card>
  );
}

function ConnectModal({
  opened,
  onClose,
  walletId,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");

  const connect = useMutation({
    mutationFn: () => connectBank(walletId, token.trim(), name.trim()),
    onSuccess: () => {
      notifications.show({ color: "teal", message: t("banksync.connected") });
      setName("");
      setToken("");
      onDone();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Modal opened={opened} onClose={onClose} title={t("banksync.connectTitle")}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("banksync.connectHint")}
        </Text>
        <TextInput
          data-autofocus
          label={t("banksync.name")}
          placeholder={t("banksync.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <TextInput
          label={t("banksync.setupToken")}
          placeholder="Base64 setup token…"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          styles={{ input: { fontFamily: "monospace" } }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("banksync.cancel")}
          </Button>
          <Button
            disabled={!token.trim()}
            loading={connect.isPending}
            onClick={() => connect.mutate()}
          >
            {t("banksync.connect")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
