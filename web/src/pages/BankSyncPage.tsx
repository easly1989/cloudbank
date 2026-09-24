import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Code,
  CopyButton,
  Divider,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBuildingBank,
  IconCheck,
  IconCopy,
  IconExternalLink,
  IconHistory,
  IconKey,
  IconPlugConnected,
  IconPlus,
  IconRefreshDot,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorColor } from "../amountTone";
import { useConfirm } from "../components/confirmContext";

import {
  ApiError,
  type BankConnection,
  clearBankConnectionSyncRuns,
  connectBank,
  connectPluggy,
  deleteEnableBankingConfig,
  deletePluggyConfig,
  getEnableBankingConfig,
  getPluggyConfig,
  linkBankAccount,
  listAccounts,
  listBankConnections,
  listBankConnectionSyncRuns,
  listBankRemoteAccounts,
  listEnableBankingBanks,
  reauthEnableBankingConnection,
  removeBankConnection,
  setBankConnectionAutoSync,
  setBankConnectionSchedule,
  setEnableBankingConfig,
  setPluggyConfig,
  startEnableBankingAuth,
  syncBankConnection,
  unlinkBankAccount,
} from "../api/client";
import { useDateFormat } from "../dates";
import { localScheduleToUtc, utcScheduleToLocal } from "../schedule";
import { useWallet } from "../wallet/WalletProvider";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";

// The Enable Banking redirect target — must be whitelisted in the user's app.
const ebRedirectUrl = () => `${window.location.origin}/bank-sync/callback`;

// Hours of day (local) for the auto-sync time picker, and weekdays in Mon-first
// display order (values are 0=Sunday .. 6=Saturday to match the stored schedule).
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}));
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

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
      <PageHeader tour="bankSync" title={t("banksync.title")} hint={t("banksync.hint")} />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" data-tour="banksync-providers">
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
        <PluggyPanel walletId={walletId} />
      </SimpleGrid>

      <Title order={4} mt="sm" data-tour="banksync-connections">
        {t("banksync.connectedTitle")}
      </Title>
      {(connections.data ?? []).length === 0 ? (
        <Card withBorder>
          <EmptyState
            icon={IconBuildingBank}
            message={t("banksync.empty")}
            hint={t("banksync.emptyHint")}
          />
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

function syncStatusColor(status: string): string {
  if (status === "error") return "red";
  if (status === "partial") return "orange";
  return "teal";
}

// A human label for the provider id shown in the connection header badge.
function providerLabel(provider: string): string {
  if (provider === "simplefin") return "SimpleFIN";
  if (provider === "enablebanking") return "Enable Banking";
  if (provider === "pluggy") return "Pluggy";
  return provider;
}

function ConnectionCard({
  walletId,
  connection,
}: {
  walletId: number;
  connection: BankConnection;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const history = useQuery({
    queryKey: ["bankHistory", walletId, connection.id],
    queryFn: () => listBankConnectionSyncRuns(walletId, connection.id),
    enabled: walletId > 0 && historyOpen,
  });

  const refreshConns = () => void qc.invalidateQueries({ queryKey: ["bankConnections", walletId] });

  const sync = useMutation({
    mutationFn: () => syncBankConnection(walletId, connection.id),
    onSuccess: (res) => {
      const failed = res.failed ?? 0;
      notifications.show({
        color: failed > 0 ? "orange" : "teal",
        message:
          failed > 0
            ? t("banksync.syncedPartial", {
                imported: res.imported,
                reconciled: res.reconciled,
                warnings: (res.warnings ?? []).join("; "),
              })
            : t("banksync.synced", { imported: res.imported, reconciled: res.reconciled }),
        autoClose: failed > 0 ? 8000 : undefined,
      });
      void qc.invalidateQueries({ queryKey: ["register", walletId] });
      void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
      void qc.invalidateQueries({ queryKey: ["bankRemote", walletId, connection.id] });
      void qc.invalidateQueries({ queryKey: ["bankHistory", walletId, connection.id] });
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
  const autoSync = useMutation({
    mutationFn: (enabled: boolean) => setBankConnectionAutoSync(walletId, connection.id, enabled),
    onSuccess: refreshConns,
    onError,
  });
  const schedule = useMutation({
    mutationFn: (s: { hour: number; days: number[] }) =>
      setBankConnectionSchedule(walletId, connection.id, s),
    onSuccess: refreshConns,
    onError,
  });
  const autoSyncOn = connection.autoSync ?? true;
  // The stored schedule is UTC; present and edit it in the user's local time.
  const localSchedule = utcScheduleToLocal(
    connection.syncHour ?? 3,
    connection.syncDays ?? [0, 1, 2, 3, 4, 5, 6],
  );

  // Enable Banking consent status from validUntil (~90-day PSD2 consent).
  //
  // "Now" is read once, when the card mounts, rather than on every render: a
  // render that reads the clock gives a different answer each time it runs, and
  // this one is counting down whole days over three months, so a session that
  // outlives the reading by an hour still says the same thing.
  const [now] = useState(() => Date.now());
  const consent = (() => {
    if (connection.provider !== "enablebanking" || !connection.validUntil) return null;
    const ms = new Date(connection.validUntil).getTime();
    if (Number.isNaN(ms)) return null;
    const days = Math.ceil((ms - now) / 86_400_000);
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
  const clearHistory = useMutation({
    mutationFn: () => clearBankConnectionSyncRuns(walletId, connection.id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["bankHistory", walletId, connection.id] }),
    onError,
  });

  const accountOptions = (accountsQuery.data ?? []).map((a) => ({
    value: String(a.id),
    label: a.name,
  }));

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="gray" size={38} radius="md">
            <IconBuildingBank size={20} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Group gap={6} wrap="nowrap">
              <Text fw={600} truncate>
                {connection.name || t("banksync.unnamed")}
              </Text>
              <Badge size="xs" variant="light" color="gray">
                {providerLabel(connection.provider)}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {connection.lastSyncedAt
                ? t("banksync.lastSynced", { date: fmtDate(connection.lastSyncedAt) })
                : t("banksync.neverSynced")}
            </Text>
            {(connection.lastSyncAt || consent) && (
              <Group gap={6} mt={4} wrap="wrap">
                {connection.lastSyncAt && (
                  <Tooltip
                    withArrow
                    multiline
                    label={`${fmtDate(connection.lastSyncAt)} ${new Date(
                      connection.lastSyncAt,
                    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${
                      connection.lastSyncMessage ? ` — ${connection.lastSyncMessage}` : ""
                    }`}
                  >
                    <Badge
                      size="xs"
                      variant="light"
                      color={syncStatusColor(connection.lastSyncStatus ?? "ok")}
                    >
                      {t(`banksync.history.status.${connection.lastSyncStatus ?? "ok"}`)}
                    </Badge>
                  </Tooltip>
                )}
                {consent && (
                  <Badge
                    size="xs"
                    variant="light"
                    color={consent.color === "dimmed" ? "gray" : consent.color}
                  >
                    {consent.text}
                  </Badge>
                )}
              </Group>
            )}
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap">
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
              onClick={async () => {
                const ok = await confirm({
                  title: t("banksync.confirmRemoveTitle", { name: connection.name }),
                  body: t("banksync.confirmRemoveBody"),
                  confirmLabel: t("banksync.remove"),
                  danger: true,
                });
                if (ok) remove.mutate();
              }}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Divider my="md" label={t("banksync.section.autoSync")} labelPosition="left" />

      <Stack gap="xs">
        <Switch
          size="sm"
          checked={autoSyncOn}
          onChange={(e) => autoSync.mutate(e.currentTarget.checked)}
          label={t("banksync.autoSync")}
          description={t("banksync.autoSyncHint")}
        />
        {autoSyncOn && (
          <Group gap="lg" align="flex-end" wrap="wrap">
            <Select
              size="xs"
              w={130}
              label={t("banksync.schedule.time")}
              disabled={schedule.isPending}
              value={String(localSchedule.hour)}
              onChange={(v) => {
                if (v == null) return;
                schedule.mutate(localScheduleToUtc(Number(v), localSchedule.days));
              }}
              data={HOUR_OPTIONS}
              comboboxProps={{ withinPortal: true }}
            />
            <div>
              <Text size="xs" fw={500} mb={4}>
                {t("banksync.schedule.days")}
              </Text>
              <Chip.Group
                multiple
                value={localSchedule.days.map(String)}
                onChange={(vals) =>
                  schedule.mutate(
                    localScheduleToUtc(
                      localSchedule.hour,
                      vals.map(Number).sort((a, b) => a - b),
                    ),
                  )
                }
              >
                <Group gap={4}>
                  {WEEKDAY_ORDER.map((d) => (
                    <Chip key={d} value={String(d)} size="xs" variant="outline">
                      {t(`banksync.schedule.weekday.${d}`)}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
            </div>
          </Group>
        )}
      </Stack>

      <Divider my="md" label={t("banksync.section.accounts")} labelPosition="left" />

      {remote.isError ? (
        <Alert color="red">{t("banksync.remoteError")}</Alert>
      ) : (
        <Stack gap="xs">
          {(remote.data ?? []).length === 0 ? (
            <Stack gap={6}>
              <Text c="dimmed" size="sm">
                {t("banksync.noRemote")}
              </Text>
              {connection.provider === "enablebanking" && (
                <Alert color="yellow" variant="light" py="xs">
                  <Text size="xs">{t("banksync.noRemoteHintEb")}</Text>
                </Alert>
              )}
            </Stack>
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
                    <Badge size="sm" color="teal" variant="dot">
                      {t("banksync.linked")}
                    </Badge>
                  ) : (
                    <Badge size="sm" color="gray" variant="dot">
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

      <Accordion
        variant="contained"
        mt="sm"
        value={historyOpen ? "history" : null}
        onChange={(v) => setHistoryOpen(v === "history")}
      >
        <Accordion.Item value="history">
          <Accordion.Control icon={<IconHistory size={16} />}>
            <Text size="sm">{t("banksync.history.title")}</Text>
          </Accordion.Control>
          <Accordion.Panel>
            {history.isLoading ? (
              <Group justify="center" py="sm">
                <Loader size="sm" />
              </Group>
            ) : (history.data ?? []).length === 0 ? (
              <Text size="sm" c="dimmed">
                {t("banksync.history.empty")}
              </Text>
            ) : (
              <Stack gap="xs">
                <Group justify="flex-end">
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    loading={clearHistory.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t("banksync.history.confirmClearTitle"),
                        body: t("banksync.history.confirmClearBody"),
                        confirmLabel: t("banksync.history.clear"),
                        danger: true,
                      });
                      if (ok) clearHistory.mutate();
                    }}
                  >
                    {t("banksync.history.clear")}
                  </Button>
                </Group>
                {(history.data ?? []).map((run) => (
                  <Card key={run.id} withBorder padding="xs" radius="sm">
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Text size="xs" fw={500}>
                        {fmtDate(run.ranAt)}{" "}
                        {new Date(run.ranAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                      <Group gap={6} wrap="nowrap">
                        {run.triggeredBy && (
                          <Badge size="xs" variant="light" color="gray">
                            {t(`banksync.history.trigger.${run.triggeredBy}`)}
                          </Badge>
                        )}
                        <Badge size="xs" variant="dot" color={syncStatusColor(run.status)}>
                          {t(`banksync.history.status.${run.status}`)}
                        </Badge>
                      </Group>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {t("banksync.history.summary", {
                        imported: run.imported,
                        reconciled: run.reconciled,
                      })}
                    </Text>
                    {run.accounts.map((a) => (
                      <Text key={a.externalId} size="xs" mt={2}>
                        <Text span fw={500}>
                          {a.name || a.externalId}
                        </Text>
                        {": "}
                        {a.error ? (
                          <Text span c={errorColor}>
                            {a.error}
                          </Text>
                        ) : (
                          t("banksync.history.account", {
                            imported: a.imported,
                            reconciled: a.reconciled,
                          })
                        )}
                      </Text>
                    ))}
                    {run.message && run.accounts.length === 0 && (
                      <Text size="xs" c="dimmed">
                        {run.message}
                      </Text>
                    )}
                  </Card>
                ))}
              </Stack>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
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

// --- Pluggy (Latin America) ---
//
// Two steps, and the first happens outside CloudBank: the user links their banks
// in Meu Pluggy (Pluggy's own consumer app) and copies the resulting item id.
// There is no consent redirect to host, so this panel only needs the application
// credentials and that id.

function PluggyPanel({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const cfg = useQuery({
    queryKey: ["pluggyConfig", walletId],
    queryFn: () => getPluggyConfig(walletId),
    enabled: walletId > 0,
  });
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const removeCfg = useMutation({
    mutationFn: () => deletePluggyConfig(walletId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pluggyConfig", walletId] }),
    onError,
  });

  const configured = cfg.data?.configured ?? false;

  return (
    <Card withBorder>
      <Group gap="xs" mb="xs">
        <IconBuildingBank size={18} />
        <Text fw={600}>{t("banksync.pluggy.title")}</Text>
        <Badge size="sm" variant="light" color="gray">
          {t("banksync.pluggy.experimental")}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {t("banksync.pluggy.hint")}
      </Text>

      {configured ? (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {t("banksync.pluggy.clientId")}: <Code>{cfg.data?.clientId}</Code>
          </Text>
          <Group gap="xs">
            <Button leftSection={<IconPlus size={16} />} onClick={() => setConnectOpen(true)}>
              {t("banksync.pluggy.connect")}
            </Button>
            <Button variant="default" onClick={() => setConfigOpen(true)}>
              {t("banksync.pluggy.edit")}
            </Button>
            <Button
              variant="subtle"
              color="red"
              loading={removeCfg.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t("banksync.pluggy.confirmRemoveConfigTitle"),
                  body: t("banksync.pluggy.confirmRemoveConfigBody"),
                  confirmLabel: t("banksync.pluggy.removeConfig"),
                  danger: true,
                });
                if (ok) removeCfg.mutate();
              }}
            >
              {t("banksync.pluggy.removeConfig")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Button
          variant="light"
          leftSection={<IconKey size={16} />}
          onClick={() => setConfigOpen(true)}
        >
          {t("banksync.pluggy.configure")}
        </Button>
      )}

      <PluggyConfigModal
        opened={configOpen}
        onClose={() => setConfigOpen(false)}
        walletId={walletId}
        currentClientId={cfg.data?.clientId}
        onDone={() => void qc.invalidateQueries({ queryKey: ["pluggyConfig", walletId] })}
      />
      <PluggyConnectModal
        opened={connectOpen}
        onClose={() => setConnectOpen(false)}
        walletId={walletId}
        onDone={() => void qc.invalidateQueries({ queryKey: ["bankConnections", walletId] })}
      />
    </Card>
  );
}

// Both modals mount their form only while open. That is what resets the fields
// between openings — no effect writing state on mount, which is the pattern the
// react-hooks rules flag, and one less thing to unpick later.

function PluggyConfigModal({
  opened,
  onClose,
  walletId,
  currentClientId,
  onDone,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  currentClientId?: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal opened={opened} onClose={onClose} title={t("banksync.pluggy.configTitle")} size="lg">
      {opened && (
        <PluggyConfigForm
          walletId={walletId}
          currentClientId={currentClientId}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </Modal>
  );
}

function PluggyConfigForm({
  walletId,
  currentClientId,
  onClose,
  onDone,
}: {
  walletId: number;
  currentClientId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState(currentClientId ?? "");
  // The secret is write-only, so editing starts blank rather than echoing back
  // something the server never returns.
  const [clientSecret, setClientSecret] = useState("");

  const save = useMutation({
    mutationFn: () =>
      setPluggyConfig(walletId, { clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: () => {
      notifications.show({ color: "teal", message: t("banksync.pluggy.saved") });
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
    <Stack>
      <Text size="sm" c="dimmed">
        {t("banksync.pluggy.configHint")}
      </Text>
      <TextInput
        label={t("banksync.pluggy.clientId")}
        value={clientId}
        onChange={(e) => setClientId(e.currentTarget.value)}
      />
      <PasswordInput
        label={t("banksync.pluggy.clientSecret")}
        description={t("banksync.pluggy.secretHint")}
        value={clientSecret}
        onChange={(e) => setClientSecret(e.currentTarget.value)}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          loading={save.isPending}
          disabled={!clientId.trim() || !clientSecret.trim()}
          onClick={() => save.mutate()}
        >
          {t("common.save")}
        </Button>
      </Group>
    </Stack>
  );
}

function PluggyConnectModal({
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
  return (
    <Modal opened={opened} onClose={onClose} title={t("banksync.pluggy.connectTitle")} size="lg">
      {opened && <PluggyConnectForm walletId={walletId} onClose={onClose} onDone={onDone} />}
    </Modal>
  );
}

function PluggyConnectForm({
  walletId,
  onClose,
  onDone,
}: {
  walletId: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");

  const connect = useMutation({
    mutationFn: () => connectPluggy(walletId, { itemId: itemId.trim(), name: name.trim() }),
    onSuccess: () => {
      notifications.show({ color: "teal", message: t("banksync.pluggy.connected") });
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
    <Stack>
      <Alert color="blue" variant="light">
        {t("banksync.pluggy.itemHint")}
      </Alert>
      <TextInput
        label={t("banksync.pluggy.itemId")}
        placeholder="00000000-0000-0000-0000-000000000000"
        value={itemId}
        onChange={(e) => setItemId(e.currentTarget.value)}
      />
      <TextInput
        label={t("banksync.pluggy.name")}
        description={t("banksync.pluggy.nameHint")}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          loading={connect.isPending}
          disabled={!itemId.trim()}
          onClick={() => connect.mutate()}
        >
          {t("banksync.pluggy.connect")}
        </Button>
      </Group>
    </Stack>
  );
}

function EnableBankingPanel({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
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
              onClick={async () => {
                const ok = await confirm({
                  title: t("banksync.eb.confirmRemoveConfigTitle"),
                  body: t("banksync.eb.confirmRemoveConfigBody"),
                  confirmLabel: t("banksync.eb.removeConfig"),
                  danger: true,
                });
                if (ok) removeCfg.mutate();
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
  // is write-only and starts blank (blank = keep the stored key). Done during
  // render, so the modal never shows the previous values for a frame.
  const [seededFor, setSeededFor] = useState(opened);
  if (opened !== seededFor) {
    setSeededFor(opened);
    if (opened) {
      setAppId(currentAppId ?? "");
      setEnvironment(currentEnvironment ?? "sandbox");
      setPrivateKey("");
    }
  }

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
