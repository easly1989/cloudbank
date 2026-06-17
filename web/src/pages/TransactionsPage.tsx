import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Group,
  Modal,
  NumberFormatter,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowsExchange, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type Account,
  type RegisterRow,
  type Split,
  type Transaction,
  type TransactionInput,
  type TransferInput,
  createTransaction,
  createTransfer,
  deleteTransaction,
  deleteTransfer,
  findDuplicateTransactions,
  getRegister,
  getTransfer,
  listAccounts,
  listCategories,
  listPayees,
  listTags,
  setTransactionStatus,
  updateTransaction,
  updateTransfer,
} from "../api/client";
import { formatMinor, type MoneyFormat, parseMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterTable } from "./RegisterTable";

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

  const registerQuery = useQuery({
    queryKey: ["register", walletId, accountId],
    queryFn: () => getRegister(walletId, Number(accountId)),
    enabled: walletId > 0 && !!accountId,
  });
  const rows = registerQuery.data?.rows ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["register", walletId, accountId] });
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
  const toggleStatus = useMutation({
    mutationFn: (v: { id: number; status: number }) =>
      setTransactionStatus(walletId, v.id, v.status),
    onSuccess: invalidate,
    onError,
  });

  const editRow = (row: RegisterRow) => {
    if (row.transferId != null) {
      setEditingTransferId(row.transferId);
      transferForm.open();
    } else {
      setEditing(row);
      form.open();
    }
  };
  const deleteRow = (row: RegisterRow) => {
    if (row.transferId != null) {
      if (window.confirm(t("transfers.confirmDelete"))) removeTransfer.mutate(row.transferId);
    } else if (window.confirm(t("transactions.confirmDelete"))) {
      remove.mutate(row.id);
    }
  };

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

      {account && registerQuery.data && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <BalanceCard
            label={t("register.bank")}
            value={registerQuery.data.summary.bank}
            fmt={fmt}
          />
          <BalanceCard
            label={t("register.today")}
            value={registerQuery.data.summary.today}
            fmt={fmt}
          />
          <BalanceCard
            label={t("register.future")}
            value={registerQuery.data.summary.future}
            fmt={fmt}
          />
        </SimpleGrid>
      )}

      {account && (
        <QuickAdd walletId={walletId} account={account} onAdded={invalidate} onError={onError} />
      )}

      {account && rows.length === 0 && <Text c="dimmed">{t("transactions.empty")}</Text>}

      {account && rows.length > 0 && (
        <RegisterTable
          rows={rows}
          accounts={accounts}
          fmt={fmt}
          onEdit={editRow}
          onDelete={deleteRow}
          onToggleStatus={(row, status) => toggleStatus.mutate({ id: row.id, status })}
        />
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

function BalanceCard({ label, value, fmt }: { label: string; value: number; fmt: MoneyFormat }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="lg" fw={600} c={value < 0 ? "red" : undefined}>
        {formatMinor(value, fmt)}
      </Text>
    </Card>
  );
}

// QuickAdd is the register's one-line entry: pick a payee (its default category
// and payment mode are applied automatically), type an amount, and add without
// leaving the page.
function QuickAdd({
  walletId,
  account,
  onAdded,
  onError,
}: {
  walletId: number;
  account: Account;
  onAdded: () => void;
  onError: (err: unknown) => void;
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
  const fd = account.currencyFracDigits;
  const dc = account.currencyDecimalChar;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [payeeId, setPayeeId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");

  const onPayee = (v: string | null) => {
    setPayeeId(v);
    const p = (payeesQuery.data ?? []).find((x) => String(x.id) === v);
    if (p?.defaultCategoryId != null) setCategoryId(String(p.defaultCategoryId));
  };

  const add = useMutation({
    mutationFn: () => {
      const p = (payeesQuery.data ?? []).find((x) => String(x.id) === payeeId);
      return createTransaction(walletId, {
        accountId: account.id,
        date,
        amount: (parseMinor(amount, fd, dc) ?? 0) * (direction === "expense" ? -1 : 1),
        paymentMode: p?.defaultPaymentMode ?? 0,
        payeeId: payeeId ? Number(payeeId) : null,
        categoryId: categoryId ? Number(categoryId) : null,
      });
    },
    onSuccess: () => {
      setAmount("");
      setPayeeId(null);
      setCategoryId(null);
      onAdded();
    },
    onError,
  });

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
  const canAdd = !!date && (parseMinor(amount, fd, dc) ?? 0) > 0;

  return (
    <Card withBorder padding="xs">
      <Group gap="xs" align="flex-end" wrap="nowrap">
        <TextInput
          type="date"
          aria-label={t("transactions.date")}
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
          w={150}
        />
        <Select
          placeholder={t("transactions.payee")}
          data={(payeesQuery.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))}
          value={payeeId}
          onChange={onPayee}
          clearable
          searchable
          style={{ flex: 1 }}
        />
        <Select
          placeholder={t("transactions.category")}
          data={categoryOptions}
          value={categoryId}
          onChange={setCategoryId}
          clearable
          searchable
          style={{ flex: 1 }}
        />
        <SegmentedControl
          value={direction}
          onChange={(v) => setDirection(v as "expense" | "income")}
          data={[
            { value: "expense", label: "−" },
            { value: "income", label: "+" },
          ]}
        />
        <TextInput
          placeholder={t("transactions.amount")}
          aria-label={t("transactions.amount")}
          value={amount}
          onChange={(e) => setAmount(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAdd) add.mutate();
          }}
          w={130}
        />
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => add.mutate()}
          loading={add.isPending}
          disabled={!canAdd}
        >
          {t("register.quickAdd")}
        </Button>
      </Group>
    </Card>
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
