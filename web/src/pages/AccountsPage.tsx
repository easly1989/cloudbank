import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconReportMoney, IconTrash, IconWallet } from "@tabler/icons-react";
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
                      <Text fw={600} c={a.balance < a.minimumBalance ? attentionColor : undefined}>
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
                        {(a.type === "asset" || a.type === "investment") && (
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
                          onClick={async () => {
                            const ok = await confirm({
                              title: t("accounts.confirmDeleteTitle", { name: a.name }),
                              body: t("accounts.confirmDeleteBody"),
                              confirmLabel: t("accounts.confirmDeleteAction"),
                              danger: true,
                            });
                            if (ok) remove.mutate(a.id);
                          }}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
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
