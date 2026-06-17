import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NumberFormatter,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowsExchange, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type Split,
  type Transaction,
  type TransactionInput,
  type TransferInput,
  createTransaction,
  createTransfer,
  deleteTransaction,
  deleteTransfer,
  findDuplicateTransactions,
  getTransfer,
  listAccounts,
  listCategories,
  listPayees,
  listTags,
  listTransactions,
  updateTransaction,
  updateTransfer,
} from "../api/client";
import { formatMinor, parseMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";

const PAYMENT_MODES = Array.from({ length: 12 }, (_, i) => i);
const STATUSES = [0, 1, 2, 3, 4];

export function TransactionsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const [accountId, setAccountId] = useState<string | null>(null);
  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(String(accounts[0].id));
  }, [accounts, accountId]);
  const account = accounts.find((a) => String(a.id) === accountId);

  const txQuery = useQuery({
    queryKey: ["transactions", walletId, accountId],
    queryFn: () => listTransactions(walletId, Number(accountId)),
    enabled: walletId > 0 && !!accountId,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["transactions", walletId, accountId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const [formOpened, form] = useDisclosure(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [transferOpened, transferForm] = useDisclosure(false);
  const [editingTransferId, setEditingTransferId] = useState<number | null>(null);

  const remove = useMutation({
    mutationFn: (id: number) => deleteTransaction(walletId, id),
    onSuccess: invalidate,
    onError,
  });
  const removeTransfer = useMutation({
    mutationFn: (id: number) => deleteTransfer(walletId, id),
    onSuccess: invalidate,
    onError,
  });

  if (!currentWallet) return null;
  const fmt = account
    ? {
        fracDigits: account.currencyFracDigits,
        decimalChar: account.currencyDecimalChar,
        groupChar: account.currencyGroupChar,
        symbol: account.currencySymbol,
        symbolPrefix: account.currencySymbolPrefix,
      }
    : { fracDigits: 2, decimalChar: ".", groupChar: ",", symbol: "", symbolPrefix: false };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("transactions.title")}</Title>
        <Group>
          <Select
            aria-label={t("transactions.account")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={accountId}
            onChange={setAccountId}
            allowDeselect={false}
            w={220}
          />
          <Button
            variant="default"
            leftSection={<IconArrowsExchange size={16} />}
            disabled={accounts.length < 2}
            onClick={() => {
              setEditingTransferId(null);
              transferForm.open();
            }}
          >
            {t("transfers.add")}
          </Button>
          <Button
            leftSection={<IconPlus size={16} />}
            disabled={!account}
            onClick={() => {
              setEditing(null);
              form.open();
            }}
          >
            {t("transactions.add")}
          </Button>
        </Group>
      </Group>

      {accounts.length === 0 && <Text c="dimmed">{t("transactions.noAccounts")}</Text>}
      {account && (txQuery.data?.transactions.length ?? 0) === 0 && (
        <Text c="dimmed">{t("transactions.empty")}</Text>
      )}

      {account && (txQuery.data?.transactions.length ?? 0) > 0 && (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("transactions.date")}</Table.Th>
              <Table.Th>{t("transactions.payee")}</Table.Th>
              <Table.Th>{t("transactions.category")}</Table.Th>
              <Table.Th ta="right">{t("transactions.amount")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {txQuery.data?.transactions.map((tx) => {
              const counterpart =
                tx.transferId != null
                  ? accounts.find((a) => a.id === tx.transferAccountId)?.name
                  : undefined;
              return (
                <Table.Tr key={tx.id}>
                  <Table.Td>{tx.date}</Table.Td>
                  <Table.Td>
                    {tx.transferId != null ? (
                      <Group gap={4} wrap="nowrap">
                        <IconArrowsExchange size={14} />
                        <Text size="sm">{counterpart ?? t("transfers.transfer")}</Text>
                      </Group>
                    ) : (
                      tx.payeeName
                    )}
                  </Table.Td>
                  <Table.Td>
                    {tx.transferId != null
                      ? t("transfers.transfer")
                      : tx.isSplit
                        ? t("transactions.split")
                        : tx.categoryName}
                  </Table.Td>
                  <Table.Td ta="right">
                    <Text c={tx.amount < 0 ? "red" : "teal"}>{formatMinor(tx.amount, fmt)}</Text>
                  </Table.Td>
                  <Table.Td ta="right" w={90}>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        aria-label={t("transactions.edit")}
                        onClick={() => {
                          if (tx.transferId != null) {
                            setEditingTransferId(tx.transferId);
                            transferForm.open();
                          } else {
                            setEditing(tx);
                            form.open();
                          }
                        }}
                      >
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("transactions.delete")}
                        onClick={() => {
                          if (tx.transferId != null) {
                            if (window.confirm(t("transfers.confirmDelete")))
                              removeTransfer.mutate(tx.transferId);
                          } else if (window.confirm(t("transactions.confirmDelete"))) {
                            remove.mutate(tx.id);
                          }
                        }}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      )}

      {account && (
        <TransactionForm
          opened={formOpened}
          onClose={form.close}
          walletId={walletId}
          account={account}
          editing={editing}
          onSaved={invalidate}
        />
      )}

      <TransferForm
        opened={transferOpened}
        onClose={transferForm.close}
        walletId={walletId}
        accounts={accounts}
        editingId={editingTransferId}
        onSaved={invalidate}
      />
    </Stack>
  );
}

function TransactionForm({
  opened,
  onClose,
  walletId,
  account,
  editing,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  account: Account;
  editing: Transaction | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const tagsQuery = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });

  const dc = account.currencyDecimalChar;
  const fd = account.currencyFracDigits;

  const [date, setDate] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("0");
  const [status, setStatus] = useState("0");
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [info, setInfo] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState<{ categoryId: string | null; amount: string }[]>([]);

  useEffect(() => {
    if (!opened) return;
    const e = editing;
    setDate(e?.date ?? new Date().toISOString().slice(0, 10));
    setDirection((e?.amount ?? -1) < 0 ? "expense" : "income");
    setAmount(e ? minorToInput(Math.abs(e.amount), fd, dc) : "");
    setPaymentMode(String(e?.paymentMode ?? 0));
    setStatus(String(e?.status ?? 0));
    setPayeeId(e?.payeeId ? String(e.payeeId) : null);
    setCategoryId(e?.categoryId ? String(e.categoryId) : null);
    setMemo(e?.memo ?? "");
    setInfo(e?.info ?? "");
    setTags(e?.tags ?? []);
    setIsSplit(e?.isSplit ?? false);
    setSplits(
      e?.splits?.map((s) => ({
        categoryId: s.categoryId ? String(s.categoryId) : null,
        amount: minorToInput(Math.abs(s.amount), fd, dc),
      })) ?? [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editing?.id]);

  const sign = direction === "expense" ? -1 : 1;
  const totalMinor = (parseMinor(amount, fd, dc) ?? 0) * sign;
  const splitSumMinor = splits.reduce(
    (sum, s) => sum + (parseMinor(s.amount, fd, dc) ?? 0) * sign,
    0,
  );
  const splitMismatch = isSplit && splits.length > 0 && splitSumMinor !== totalMinor;

  // Duplicate warning.
  const dupQuery = useQuery({
    queryKey: ["dup", walletId, account.id, date, totalMinor],
    queryFn: () => findDuplicateTransactions(walletId, account.id, date, totalMinor),
    enabled: opened && !editing && !!date && totalMinor !== 0,
  });
  const duplicates = (dupQuery.data ?? []).filter((d) => d.id !== editing?.id);

  const save = useMutation({
    mutationFn: () => {
      const body: TransactionInput = {
        accountId: account.id,
        date,
        amount: totalMinor,
        paymentMode: Number(paymentMode),
        status: Number(status),
        info,
        memo,
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: isSplit ? null : categoryId ? Number(categoryId) : null,
        tags,
        splits: isSplit
          ? splits.map<Split>((s) => ({
              categoryId: s.categoryId ? Number(s.categoryId) : null,
              amount: (parseMinor(s.amount, fd, dc) ?? 0) * sign,
            }))
          : [],
      };
      return editing
        ? updateTransaction(walletId, editing.id, body)
        : createTransaction(walletId, body);
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

  const payeeOptions = (payeesQuery.data ?? []).map((p) => ({
    value: String(p.id),
    label: p.name,
  }));
  const categoryOptions = useMemo(
    () =>
      (categoriesQuery.data ?? []).map((c) => ({
        value: String(c.id),
        label: c.parentId
          ? `   ${(categoriesQuery.data ?? []).find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
          : c.name,
      })),
    [categoriesQuery.data],
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={editing ? t("transactions.editTitle") : t("transactions.addTitle")}
    >
      <Stack>
        {duplicates.length > 0 && (
          <Alert color="yellow">
            {t("transactions.duplicateWarning", { count: duplicates.length })}
          </Alert>
        )}
        <Group grow>
          <TextInput
            type="date"
            label={t("transactions.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <SegmentedControl
            value={direction}
            onChange={(v) => setDirection(v as "expense" | "income")}
            data={[
              { value: "expense", label: t("transactions.expense") },
              { value: "income", label: t("transactions.income") },
            ]}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t("transactions.amount")}
            value={amount}
            onChange={(e) => setAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{account.currencyCode}</Text>}
          />
          <Select
            label={t("transactions.paymentMode")}
            data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
            value={paymentMode}
            onChange={(v) => v && setPaymentMode(v)}
            allowDeselect={false}
          />
        </Group>
        <Select
          label={t("transactions.payee")}
          data={payeeOptions}
          value={payeeId}
          onChange={setPayeeId}
          clearable
          searchable
        />
        <Switch
          label={t("transactions.splitToggle")}
          checked={isSplit}
          onChange={(e) => setIsSplit(e.currentTarget.checked)}
        />
        {!isSplit ? (
          <Select
            label={t("transactions.category")}
            data={categoryOptions}
            value={categoryId}
            onChange={setCategoryId}
            clearable
            searchable
          />
        ) : (
          <Stack gap="xs">
            {splits.map((s, i) => (
              <Group key={i} grow>
                <Select
                  placeholder={t("transactions.category")}
                  data={categoryOptions}
                  value={s.categoryId}
                  onChange={(v) =>
                    setSplits((arr) => arr.map((x, j) => (j === i ? { ...x, categoryId: v } : x)))
                  }
                  searchable
                />
                <TextInput
                  placeholder={t("transactions.amount")}
                  value={s.amount}
                  onChange={(e) =>
                    setSplits((arr) =>
                      arr.map((x, j) => (j === i ? { ...x, amount: e.currentTarget.value } : x)),
                    )
                  }
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => setSplits((arr) => arr.filter((_, j) => j !== i))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Group justify="space-between">
              <Button
                size="xs"
                variant="default"
                onClick={() => setSplits((arr) => [...arr, { categoryId: null, amount: "" }])}
              >
                {t("transactions.addSplit")}
              </Button>
              {splitMismatch && (
                <Text size="sm" c="red">
                  {t("transactions.splitMismatch")} (
                  <NumberFormatter
                    value={splitSumMinor / Math.pow(10, fd)}
                    decimalScale={fd}
                  /> / <NumberFormatter value={totalMinor / Math.pow(10, fd)} decimalScale={fd} />)
                </Text>
              )}
            </Group>
          </Stack>
        )}
        <TagsInput
          label={t("transactions.tags")}
          data={tagsQuery.data ?? []}
          value={tags}
          onChange={setTags}
        />
        <Group grow>
          <Select
            label={t("transactions.status")}
            data={STATUSES.map((st) => ({ value: String(st), label: t(`status.${st}`) }))}
            value={status}
            onChange={(v) => v && setStatus(v)}
            allowDeselect={false}
          />
          <TextInput
            label={t("transactions.info")}
            value={info}
            onChange={(e) => setInfo(e.currentTarget.value)}
          />
        </Group>
        <TextInput
          label={t("transactions.memo")}
          value={memo}
          onChange={(e) => setMemo(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("transactions.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!date || totalMinor === 0 || splitMismatch}
          >
            {t("transactions.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function TransferForm({
  opened,
  onClose,
  walletId,
  accounts,
  editingId,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  accounts: Account[];
  editingId: number | null;
  onSaved: () => void;
}) {
  const { t } = useTranslation();

  const transferQuery = useQuery({
    queryKey: ["transfer", walletId, editingId],
    queryFn: () => getTransfer(walletId, editingId as number),
    enabled: opened && editingId != null,
  });
  const loaded = transferQuery.data;

  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [status, setStatus] = useState("0");

  useEffect(() => {
    if (!opened) return;
    if (editingId != null) {
      if (!loaded) return;
      const from = accounts.find((a) => a.id === loaded.fromAccountId);
      const to = accounts.find((a) => a.id === loaded.toAccountId);
      setFromId(String(loaded.fromAccountId));
      setToId(String(loaded.toAccountId));
      setDate(loaded.date);
      setFromAmount(
        from
          ? minorToInput(loaded.fromAmount, from.currencyFracDigits, from.currencyDecimalChar)
          : "",
      );
      setToAmount(
        to ? minorToInput(loaded.toAmount, to.currencyFracDigits, to.currencyDecimalChar) : "",
      );
      setMemo(loaded.memo);
      setStatus(String(loaded.status));
    } else {
      setFromId(accounts[0] ? String(accounts[0].id) : null);
      setToId(accounts[1] ? String(accounts[1].id) : null);
      setDate(new Date().toISOString().slice(0, 10));
      setFromAmount("");
      setToAmount("");
      setMemo("");
      setStatus("0");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, editingId, loaded?.id]);

  const fromAccount = accounts.find((a) => String(a.id) === fromId);
  const toAccount = accounts.find((a) => String(a.id) === toId);
  const crossCurrency =
    !!fromAccount && !!toAccount && fromAccount.currencyId !== toAccount.currencyId;
  const fromMinor = fromAccount
    ? (parseMinor(fromAmount, fromAccount.currencyFracDigits, fromAccount.currencyDecimalChar) ?? 0)
    : 0;
  const toMinor = toAccount
    ? (parseMinor(toAmount, toAccount.currencyFracDigits, toAccount.currencyDecimalChar) ?? 0)
    : 0;

  const save = useMutation({
    mutationFn: () => {
      const body: TransferInput = {
        fromAccountId: Number(fromId),
        toAccountId: Number(toId),
        date,
        fromAmount: fromMinor,
        toAmount: crossCurrency ? toMinor : undefined,
        memo,
        status: Number(status),
      };
      return editingId != null
        ? updateTransfer(walletId, editingId, body)
        : createTransfer(walletId, body);
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

  const accountOptions = accounts.map((a) => ({ value: String(a.id), label: a.name }));
  const invalid =
    !date ||
    !fromId ||
    !toId ||
    fromId === toId ||
    fromMinor <= 0 ||
    (crossCurrency && toMinor <= 0);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={editingId != null ? t("transfers.editTitle") : t("transfers.addTitle")}
    >
      <Stack>
        <Group grow>
          <Select
            label={t("transfers.from")}
            data={accountOptions}
            value={fromId}
            onChange={setFromId}
            disabled={editingId != null}
            allowDeselect={false}
            searchable
          />
          <Select
            label={t("transfers.to")}
            data={accountOptions}
            value={toId}
            onChange={setToId}
            disabled={editingId != null}
            allowDeselect={false}
            searchable
          />
        </Group>
        {fromId != null && fromId === toId && (
          <Text size="sm" c="red">
            {t("transfers.sameAccount")}
          </Text>
        )}
        <Group grow>
          <TextInput
            type="date"
            label={t("transactions.date")}
            value={date}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
          <TextInput
            label={crossCurrency ? t("transfers.fromAmount") : t("transactions.amount")}
            value={fromAmount}
            onChange={(e) => setFromAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{fromAccount?.currencyCode}</Text>}
          />
        </Group>
        {crossCurrency && (
          <TextInput
            label={t("transfers.toAmount")}
            value={toAmount}
            onChange={(e) => setToAmount(e.currentTarget.value)}
            rightSection={<Text size="xs">{toAccount?.currencyCode}</Text>}
          />
        )}
        <Group grow>
          <Select
            label={t("transactions.status")}
            data={STATUSES.map((st) => ({ value: String(st), label: t(`status.${st}`) }))}
            value={status}
            onChange={(v) => v && setStatus(v)}
            allowDeselect={false}
          />
          <TextInput
            label={t("transactions.memo")}
            value={memo}
            onChange={(e) => setMemo(e.currentTarget.value)}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("transactions.cancel")}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={invalid}>
            {t("transactions.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function minorToInput(amount: number, fracDigits: number, decimalChar: string): string {
  return formatMinor(amount, {
    fracDigits,
    decimalChar,
    groupChar: "",
    symbol: "",
    symbolPrefix: false,
  });
}
