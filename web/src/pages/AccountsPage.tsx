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
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { type MoneyFormat, formatMinor } from "../money";
import { rowEditProps, stopRowEdit } from "../rowEdit";
import { useAmountParser } from "../useAmountParser";
import { useWallet } from "../wallet/WalletProvider";

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
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [modalOpened, modal] = useDisclosure(false);

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

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("accounts.title")}</Title>
        <Group>
          <Switch
            label={t("accounts.showClosed")}
            checked={showClosed}
            onChange={(e) => setShowClosed(e.currentTarget.checked)}
          />
          <Button onClick={openCreate}>{t("accounts.add")}</Button>
        </Group>
      </Group>

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
                      <Text fw={600} c={a.balance < a.minimumBalance ? "red" : undefined}>
                        {formatMinor(a.balance, acctFmt(a))}
                      </Text>
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
                          onClick={() => {
                            if (window.confirm(t("accounts.confirmDelete", { name: a.name })))
                              remove.mutate(a.id);
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

      {accounts.length === 0 && <Text c="dimmed">{t("accounts.empty")}</Text>}

      <AccountModal
        opened={modalOpened}
        onClose={modal.close}
        walletId={walletId}
        account={editing}
        onSaved={invalidate}
      />
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

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("bank");
  const [currencyId, setCurrencyId] = useState<string | null>(null);
  const [institution, setInstitution] = useState("");
  const [number, setNumber] = useState("");
  const [initial, setInitial] = useState("");
  const [minimum, setMinimum] = useState("");
  const [closed, setClosed] = useState(false);
  const [groupName, setGroupName] = useState("");

  // Reset the form whenever the modal opens for a (different) account.
  useEffect(() => {
    if (!opened) return;
    setName(account?.name ?? "");
    setType(account?.type ?? "bank");
    setCurrencyId(String(account?.currencyId ?? base?.id ?? ""));
    setInstitution(account?.institution ?? "");
    setNumber(account?.number ?? "");
    setGroupName(account?.groupName ?? "");
    setClosed(account?.closed ?? false);
    const cur = currencies.find((c) => c.id === (account?.currencyId ?? base?.id));
    const fd = cur?.fracDigits ?? 2;
    const dc = cur?.decimalChar ?? ".";
    setInitial(account ? minorToInput(account.initialBalance, fd, dc) : "");
    setMinimum(account ? minorToInput(account.minimumBalance, fd, dc) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, account?.id]);

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

// minorToInput renders minor units as a plain editable decimal string using the
// currency's separator (no grouping, no symbol).
function minorToInput(amount: number, fracDigits: number, decimalChar: string): string {
  return formatMinor(amount, {
    fracDigits,
    decimalChar,
    groupChar: "",
    symbol: "",
    symbolPrefix: false,
  });
}
