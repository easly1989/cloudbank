import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBuildingBank,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconKey,
  IconPlugConnected,
  IconPlus,
  IconRefreshDot,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type BankConnection,
  connectBank,
  deleteEnableBankingConfig,
  getEnableBankingConfig,
  linkBankAccount,
  listAccounts,
  listBankConnections,
  listBankRemoteAccounts,
  listEnableBankingBanks,
  reauthEnableBankingConnection,
  removeBankConnection,
  setEnableBankingConfig,
  startEnableBankingAuth,
  syncBankConnection,
  unlinkBankAccount,
} from "../api/client";
import { useDateFormat } from "../dates";
import { useWallet } from "../wallet/WalletProvider";

// The Enable Banking redirect target — must be whitelisted in the user's app.
const ebRedirectUrl = () => `${window.location.origin}/bank-sync/callback`;

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
      <div>
        <Title order={2}>{t("banksync.title")}</Title>
        <Text c="dimmed" size="sm" maw={680}>
          {t("banksync.hint")}
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder>
          <Group gap="xs" mb="xs">
            <IconBuildingBank size={18} />
            <Text fw={600}>{t("banksync.simplefin.title")}</Text>
          </Group>
          <Text size="sm" c="dimmed" mb="sm">
            {t("banksync.simplefin.hint")}
          </Text>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setAddOpen(true)}>
            {t("banksync.connect")}
          </Button>
        </Card>

        <EnableBankingPanel walletId={walletId} />
      </SimpleGrid>

      <Title order={4} mt="sm">
        {t("banksync.connectedTitle")}
      </Title>
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
  const reconnect = useMutation({
    mutationFn: () => reauthEnableBankingConnection(walletId, connection.id, ebRedirectUrl()),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError,
  });

  // Enable Banking consent status from validUntil (~90-day PSD2 consent).
  const consent = (() => {
    if (connection.provider !== "enablebanking" || !connection.validUntil) return null;
    const ms = new Date(connection.validUntil).getTime();
    if (Number.isNaN(ms)) return null;
    const days = Math.ceil((ms - Date.now()) / 86_400_000);
    if (days < 0)
      return { text: t("banksync.eb.consentExpired"), color: "red" as const, urgent: true };
    if (days <= 7)
      return {
        text: t("banksync.eb.consentExpiresSoon", { days }),
        color: "orange" as const,
        urgent: true,
      };
    return {
      text: t("banksync.eb.consentValid", { days }),
      color: "dimmed" as const,
      urgent: false,
    };
  })();
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
            {consent && (
              <Text size="xs" c={consent.color} fw={consent.urgent ? 600 : 400}>
                {consent.text}
              </Text>
            )}
          </div>
        </Group>
        <Group gap="xs">
          {connection.provider === "enablebanking" && (
            <Button
              variant={consent?.urgent ? "filled" : "light"}
              color={consent?.urgent ? "orange" : "gray"}
              leftSection={<IconPlugConnected size={16} />}
              loading={reconnect.isPending}
              onClick={() => reconnect.mutate()}
            >
              {t("banksync.eb.reconnect")}
            </Button>
          )}
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

// --- Enable Banking (EU/PSD2) ---

function EnableBankingPanel({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const cfg = useQuery({
    queryKey: ["ebConfig", walletId],
    queryFn: () => getEnableBankingConfig(walletId),
    enabled: walletId > 0,
  });
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const removeCfg = useMutation({
    mutationFn: () => deleteEnableBankingConfig(walletId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ebConfig", walletId] }),
    onError,
  });

  const configured = cfg.data?.configured ?? false;
  const invalidateCfg = () => void qc.invalidateQueries({ queryKey: ["ebConfig", walletId] });

  return (
    <Card withBorder>
      <Group gap="xs" mb="xs">
        <IconBuildingBank size={18} />
        <Text fw={600}>{t("banksync.eb.title")}</Text>
        {configured && cfg.data?.environment && (
          <Badge size="sm" variant="light" color="teal">
            {cfg.data.environment}
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {t("banksync.eb.hint")}
      </Text>

      {configured ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {t("banksync.eb.appId")}: <Code>{cfg.data?.appId}</Code>
          </Text>
          <Group gap="xs">
            <Button leftSection={<IconPlus size={16} />} onClick={() => setConnectOpen(true)}>
              {t("banksync.eb.connect")}
            </Button>
            <Button variant="default" onClick={() => setConfigOpen(true)}>
              {t("banksync.eb.edit")}
            </Button>
            <Button
              variant="subtle"
              color="red"
              loading={removeCfg.isPending}
              onClick={() => {
                if (window.confirm(t("banksync.eb.confirmRemoveConfig"))) removeCfg.mutate();
              }}
            >
              {t("banksync.eb.removeConfig")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Button
          variant="light"
          leftSection={<IconKey size={16} />}
          onClick={() => setConfigOpen(true)}
        >
          {t("banksync.eb.configure")}
        </Button>
      )}

      <EnableBankingConfigModal
        opened={configOpen}
        onClose={() => setConfigOpen(false)}
        walletId={walletId}
        configured={configured}
        currentAppId={cfg.data?.appId}
        currentEnvironment={cfg.data?.environment}
        onDone={invalidateCfg}
      />
      <EnableBankingConnectModal
        opened={connectOpen}
        onClose={() => setConnectOpen(false)}
        walletId={walletId}
      />
    </Card>
  );
}

function EnableBankingConfigModal({
  opened,
  onClose,
  walletId,
  configured,
  currentAppId,
  currentEnvironment,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  configured: boolean;
  currentAppId?: string;
  currentEnvironment?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [appId, setAppId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [environment, setEnvironment] = useState("sandbox");
  const redirectUrl = ebRedirectUrl();

  // Prefill the app id / environment when opening in edit mode; the private key
  // is write-only and starts blank (blank = keep the stored key).
  useEffect(() => {
    if (opened) {
      setAppId(currentAppId ?? "");
      setEnvironment(currentEnvironment ?? "sandbox");
      setPrivateKey("");
    }
  }, [opened, currentAppId, currentEnvironment]);

  const save = useMutation({
    mutationFn: () =>
      setEnableBankingConfig(walletId, { appId: appId.trim(), privateKey, environment }),
    onSuccess: () => {
      notifications.show({ color: "teal", message: t("banksync.eb.saved") });
      setPrivateKey("");
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
    <Modal opened={opened} onClose={onClose} title={t("banksync.eb.configTitle")} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {t("banksync.eb.configHint")}
        </Text>
        <Alert color="blue" variant="light">
          <Text size="xs" mb={4}>
            {t("banksync.eb.redirectLabel")}
          </Text>
          <Group gap="xs" wrap="nowrap">
            <Code style={{ wordBreak: "break-all" }}>{redirectUrl}</Code>
            <CopyButton value={redirectUrl}>
              {({ copied, copy }) => (
                <ActionIcon variant="subtle" onClick={copy} aria-label={t("banksync.eb.copy")}>
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
        </Alert>
        <TextInput
          data-autofocus
          label={t("banksync.eb.appId")}
          placeholder="00000000-0000-0000-0000-000000000000"
          value={appId}
          onChange={(e) => setAppId(e.currentTarget.value)}
        />
        <Textarea
          label={t("banksync.eb.privateKey")}
          placeholder={configured ? t("banksync.eb.privateKeyKeep") : "-----BEGIN PRIVATE KEY-----"}
          value={privateKey}
          onChange={(e) => setPrivateKey(e.currentTarget.value)}
          autosize
          minRows={4}
          maxRows={8}
          styles={{ input: { fontFamily: "monospace", fontSize: 11 } }}
        />
        <Select
          label={t("banksync.eb.environment")}
          data={[
            { value: "sandbox", label: "Sandbox" },
            { value: "production", label: "Production" },
          ]}
          value={environment}
          onChange={(v) => setEnvironment(v ?? "sandbox")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("banksync.cancel")}
          </Button>
          <Button
            disabled={!appId.trim() || (!privateKey.trim() && !configured)}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t("banksync.eb.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EnableBankingConnectModal({
  opened,
  onClose,
  walletId,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
}) {
  const { t } = useTranslation();
  const [country, setCountry] = useState("IT");
  const [aspsp, setAspsp] = useState<string | null>(null);
  const [name, setName] = useState("");

  const banks = useQuery({
    queryKey: ["ebBanks", walletId, country],
    queryFn: () => listEnableBankingBanks(walletId, country),
    enabled: opened && walletId > 0 && country.length >= 2,
  });

  const start = useMutation({
    mutationFn: () =>
      startEnableBankingAuth(walletId, {
        aspspName: aspsp ?? "",
        aspspCountry: country,
        name: name.trim(),
        redirectUrl: ebRedirectUrl(),
      }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const bankOptions = (banks.data ?? []).map((b) => ({ value: b.name, label: b.name }));

  return (
    <Modal opened={opened} onClose={onClose} title={t("banksync.eb.connectTitle")}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t("banksync.eb.connectHint")}
        </Text>
        <TextInput
          label={t("banksync.eb.country")}
          value={country}
          onChange={(e) => setCountry(e.currentTarget.value.toUpperCase().slice(0, 2))}
          maw={120}
        />
        <Select
          label={t("banksync.eb.bank")}
          placeholder={banks.isLoading ? t("banksync.eb.loadingBanks") : t("banksync.eb.pickBank")}
          data={bankOptions}
          value={aspsp}
          onChange={setAspsp}
          searchable
          nothingFoundMessage={
            banks.isError ? t("banksync.eb.banksError") : t("banksync.eb.noBanks")
          }
        />
        <TextInput
          label={t("banksync.name")}
          placeholder={t("banksync.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("banksync.cancel")}
          </Button>
          <Button
            disabled={!aspsp}
            loading={start.isPending}
            rightSection={<IconExternalLink size={16} />}
            onClick={() => start.mutate()}
          >
            {t("banksync.eb.continue")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
