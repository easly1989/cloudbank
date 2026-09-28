import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconDots, IconPencil, IconReportMoney, IconTrash, IconWallet } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConfirm } from "../components/confirmContext";
import { AssetValuationsModal } from "../components/AssetValuationsModal";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

import {
  ApiError,
  type Account,
  type AccountInput,
  type AccountType,
  createAccount,
  deleteAccount,
  listAccounts,
  listCurrencies,
  updateAccount,
} from "../api/client";
import { type MoneyFormat, formatMinor, minorToInput } from "../money";
import { rowEditProps, stopRowEdit } from "../rowEdit";
import { PAYMENT_MODES } from "../transactionEnums";
import { useAmountParser } from "../useAmountParser";
import { useWallet } from "../wallet/WalletProvider";
import { attentionColor } from "../amountTone";

const acctFmt = (a: Account): MoneyFormat => ({
  fracDigits: a.currencyFracDigits,
  decimalChar: a.currencyDecimalChar,
  groupChar: a.currencyGroupChar,
  symbol: a.currencySymbol,
  symbolPrefix: a.currencySymbolPrefix,
});

const ACCOUNT_TYPES: AccountType[] = [
  "bank",
  "cash",
  "checking",
  "savings",
  "creditcard",
  "liability",
  "asset",
  "investment",
];

export function AccountsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [modalOpened, modal] = useDisclosure(false);
  const [valuationsFor, setValuationsFor] = useState<Account | null>(null);
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["accounts", walletId] });

  const remove = useMutation({
    mutationFn: (id: number) => deleteAccount(walletId, id),
    onSuccess: invalidate,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const openCreate = () => {
    setEditing(null);
    modal.open();
  };
  const openEdit = (a: Account) => {
    setEditing(a);
    modal.open();
  };
  const askDelete = async (a: Account) => {
    const ok = await confirm({
      title: t("accounts.confirmDeleteTitle", { name: a.name }),
      body: t("accounts.confirmDeleteBody"),
      confirmLabel: t("accounts.confirmDeleteAction"),
      danger: true,
    });
    if (ok) remove.mutate(a.id);
  };
  const hasValuations = (a: Account) => a.type === "asset" || a.type === "investment";

  if (!currentWallet) return null;
  const accounts = (accountsQuery.data ?? []).filter((a) => showClosed || !a.closed);

  // Each account's share of all same-currency accounts, by absolute balance.
  // Using magnitudes keeps it 0–100% regardless of negative (e.g. credit-card)
  // balances; shown only when a currency has more than one account.
  const absByCurrency = new Map<number, number>();
  const countByCurrency = new Map<number, number>();
  for (const a of accounts) {
    absByCurrency.set(a.currencyId, (absByCurrency.get(a.currencyId) ?? 0) + Math.abs(a.balance));
    countByCurrency.set(a.currencyId, (countByCurrency.get(a.currencyId) ?? 0) + 1);
  }
  const sharePct = (a: Account): number | null => {
    const total = absByCurrency.get(a.currencyId) ?? 0;
    if ((countByCurrency.get(a.currencyId) ?? 0) < 2 || total <= 0) return null;
    return Math.round((Math.abs(a.balance) / total) * 100);
  };

  // The empty state below offers this same button, and one screen does not
  // need it twice.
  const addButton = (
    <Button onClick={openCreate} data-tour="accounts-add">
      {t("accounts.add")}
    </Button>
  );

  return (
    <Stack>
      <PageHeader
        tour="accounts"
        title={t("accounts.title")}
        actions={
          <>
            <Switch
              wrapperProps={{ "data-tour": "accounts-closed" }}
              label={t("accounts.showClosed")}
              checked={showClosed}
              onChange={(e) => setShowClosed(e.currentTarget.checked)}
            />
            {accounts.length > 0 && addButton}
          </>
        }
      />

      {ACCOUNT_TYPES.map((type) => {
        const group = accounts.filter((a) => a.type === type);
        if (group.length === 0) return null;
        return (
          <Card withBorder key={type}>
            <Title order={4} mb="xs">
              {t(`accounts.types.${type}`)}
            </Title>
            {phone ? (
              <Stack gap={0}>
                {group.map((a) => (
                  <PhoneAccountRow
                    key={a.id}
                    account={a}
                    share={sharePct(a)}
                    onEdit={() => openEdit(a)}
                    onValuations={hasValuations(a) ? () => setValuationsFor(a) : undefined}
                    onDelete={() => void askDelete(a)}
                  />
                ))}
              </Stack>
            ) : (
              <Table verticalSpacing="xs">
                <Table.Tbody>
                  {group.map((a) => (
                    <Table.Tr key={a.id} {...rowEditProps(() => openEdit(a))}>
                      <Table.Td>
                        <Text fw={500}>{a.name}</Text>
                        {a.institution && (
                          <Text size="xs" c="dimmed">
                            {a.institution}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {a.closed && (
                          <Badge color="gray" size="sm">
                            {t("accounts.closed")}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text
                          fw={600}
                          c={a.balance < a.minimumBalance ? attentionColor : undefined}
                        >
                          {formatMinor(a.balance, acctFmt(a))}
                        </Text>
                        {a.value != null && (
                          <Text size="xs" c="dimmed">
                            {t("valuations.recorded")}
                          </Text>
                        )}
                        {a.futureBalance !== a.balance && (
                          <Text size="xs" c="dimmed">
                            {t("register.future")}: {formatMinor(a.futureBalance, acctFmt(a))}
                          </Text>
                        )}
                        {sharePct(a) !== null && (
                          <Text size="xs" c="dimmed">
                            {sharePct(a)}% {t("accounts.ofTotal")}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" w={90} {...stopRowEdit}>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          {hasValuations(a) && (
                            <ActionIcon
                              variant="subtle"
                              aria-label={t("valuations.manage")}
                              title={t("valuations.manage")}
                              onClick={() => setValuationsFor(a)}
                            >
                              <IconReportMoney size={16} />
                            </ActionIcon>
                          )}
                          <ActionIcon
                            variant="subtle"
                            aria-label={t("accounts.edit")}
                            onClick={() => openEdit(a)}
                          >
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={t("accounts.delete")}
                            onClick={() => void askDelete(a)}
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Card>
        );
      })}

      {accounts.length === 0 && (
        <EmptyState
          icon={IconWallet}
          message={t("accounts.empty")}
          hint={t("accounts.emptyHint")}
          action={addButton}
        />
      )}

      {/* Keyed so that opening the modal mounts a fresh form: the reset used to
          be an effect that ran after the first render, which showed empty
          fields for a frame and cost a render to fix. */}
      <AccountModal
        key={editing?.id ?? "new"}
        opened={modalOpened}
        onClose={modal.close}
        walletId={walletId}
        account={editing}
        onSaved={invalidate}
      />

      {valuationsFor && (
        <AssetValuationsModal
          opened
          onClose={() => setValuationsFor(null)}
          walletId={walletId}
          account={valuationsFor}
        />
      )}
    </Stack>
  );
}

/**
 * One account on a phone (#514): the table's four columns do not fit, so the
 * name, the amount and the actions share one line. The amount never wraps and
 * the ⋯ never shrinks; the name and its bank/share line give way, with an
 * ellipsis. The row itself is a button that opens the account for editing.
 */
function PhoneAccountRow({
  account: a,
  share,
  onEdit,
  onValuations,
  onDelete,
}: {
  account: Account;
  share: number | null;
  onEdit: () => void;
  onValuations?: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const sub = [
    a.institution,
    share !== null ? `${share}% ${t("accounts.ofTotal")}` : null,
    a.value != null ? t("valuations.recorded") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Group gap={4} wrap="nowrap" className="cb-account-row" data-testid="account-row">
      <UnstyledButton
        onClick={onEdit}
        aria-label={`${t("accounts.edit")} ${a.name}`}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={500} truncate>
              {a.name}
            </Text>
            {a.closed && (
              <Badge color="gray" size="xs" style={{ flexShrink: 0 }}>
                {t("accounts.closed")}
              </Badge>
            )}
          </Group>
          {sub && (
            <Text size="xs" c="dimmed" truncate>
              {sub}
            </Text>
          )}
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <Text
            fw={600}
            style={{ whiteSpace: "nowrap" }}
            c={a.balance < a.minimumBalance ? attentionColor : undefined}
          >
            {formatMinor(a.balance, acctFmt(a))}
          </Text>
          {a.futureBalance !== a.balance && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {t("register.future")} {formatMinor(a.futureBalance, acctFmt(a))}
            </Text>
          )}
        </div>
      </UnstyledButton>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={44}
            aria-label={t("accounts.actions", { name: a.name })}
            style={{ flexShrink: 0 }}
          >
            <IconDots size={20} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconPencil size={16} />} onClick={onEdit}>
            {t("accounts.edit")}
          </Menu.Item>
          {onValuations && (
            <Menu.Item leftSection={<IconReportMoney size={16} />} onClick={onValuations}>
              {t("valuations.manage")}
            </Menu.Item>
          )}
          <Menu.Divider />
          <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>
            {t("accounts.deleteMenu")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

function AccountModal({
  opened,
  onClose,
  walletId,
  account,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  account: Account | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const currencies = currenciesQuery.data ?? [];
  const base = currencies.find((c) => c.isBase);
  // An amount as the reader types it, in the account's own currency.
  const amountField = (minor?: number) => {
    if (account == null || minor == null) return "";
    const cur = currencies.find((c) => c.id === (account.currencyId ?? base?.id));
    return minorToInput(minor, cur?.fracDigits ?? 2, cur?.decimalChar ?? ".");
  };

  // The form starts where the account is. It used to start empty and be filled
  // in by an effect on open, which is a second render and a frame of empty
  // fields; the modal is mounted per opening now (see its `key` at the call
  // site), so initialising from the account is both simpler and correct.
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  const [currencyId, setCurrencyId] = useState<string | null>(
    String(account?.currencyId ?? base?.id ?? ""),
  );
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [number, setNumber] = useState(account?.number ?? "");
  const [initial, setInitial] = useState(() => amountField(account?.initialBalance));
  const [minimum, setMinimum] = useState(() => amountField(account?.minimumBalance));
  const [closed, setClosed] = useState(account?.closed ?? false);
  const [groupName, setGroupName] = useState(account?.groupName ?? "");
  const [defaultPaymentMode, setDefaultPaymentMode] = useState(
    String(account?.defaultPaymentMode ?? 0),
  );

  const selectedCurrency = currencies.find((c) => String(c.id) === currencyId);
  const fd = selectedCurrency?.fracDigits ?? 2;
  const dc = selectedCurrency?.decimalChar ?? ".";

  const save = useMutation({
    mutationFn: () => {
      const body: AccountInput = {
        name,
        type,
        currencyId: currencyId ? Number(currencyId) : undefined,
        institution,
        number,
        initialBalance: parseAmount(initial, fd, dc) ?? 0,
        minimumBalance: parseAmount(minimum, fd, dc) ?? 0,
        closed,
        groupName,
        defaultPaymentMode: Number(defaultPaymentMode),
      };
      return account ? updateAccount(walletId, account.id, body) : createAccount(walletId, body);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={account ? t("accounts.editTitle") : t("accounts.addTitle")}
    >
      <Stack>
        <TextInput
          label={t("accounts.name")}
          required
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Select
          label={t("accounts.type")}
          data={ACCOUNT_TYPES.map((ty) => ({ value: ty, label: t(`accounts.types.${ty}`) }))}
          value={type}
          allowDeselect={false}
          onChange={(v) => v && setType(v as AccountType)}
        />
        <Select
          label={t("accounts.currency")}
          data={currencies.map((c) => ({ value: String(c.id), label: `${c.isoCode} — ${c.name}` }))}
          value={currencyId}
          allowDeselect={false}
          onChange={setCurrencyId}
        />
        <Group grow>
          <TextInput
            label={t("accounts.initialBalance")}
            value={initial}
            onChange={(e) => setInitial(e.currentTarget.value)}
          />
          <TextInput
            label={t("accounts.minimumBalance")}
            value={minimum}
            onChange={(e) => setMinimum(e.currentTarget.value)}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t("accounts.institution")}
            value={institution}
            onChange={(e) => setInstitution(e.currentTarget.value)}
          />
          <TextInput
            label={t("accounts.number")}
            value={number}
            onChange={(e) => setNumber(e.currentTarget.value)}
          />
        </Group>
        <TextInput
          label={t("accounts.group")}
          value={groupName}
          onChange={(e) => setGroupName(e.currentTarget.value)}
        />
        <Select
          label={t("accounts.defaultPaymentMode")}
          description={t("accounts.defaultPaymentModeHint")}
          data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
          value={defaultPaymentMode}
          allowDeselect={false}
          onChange={(v) => v && setDefaultPaymentMode(v)}
        />
        <Checkbox
          label={t("accounts.closed")}
          checked={closed}
          onChange={(e) => setClosed(e.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("accounts.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name}>
            {t("accounts.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
