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
import {
  IconArrowsExchange,
  IconChecklist,
  IconDeviceFloppy,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  ApiError,
  type Account,
  type BulkField,
  type Category,
  type Payee,
  type RegisterRow,
  type Split,
  type Template,
  type Transaction,
  type TransactionInput,
  type TransferInput,
  bulkEditTransactions,
  createTemplate,
  createTemplateFromTransaction,
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
  listTemplates,
  setTransactionStatus,
  suggestAssignment,
  updateTransaction,
  updateTransfer,
} from "../api/client";
import { formatMinor, type MoneyFormat } from "../money";
import { useAmountParser } from "../useAmountParser";
import { QuickAdd } from "../components/QuickAdd";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterFilters } from "./RegisterFilters";
import { RegisterTable } from "./RegisterTable";
import { applyFilters, filtersToParams, parseFilters } from "./registerFilters";

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
  const rows = useMemo(() => registerQuery.data?.rows ?? [], [registerQuery.data]);

  const payeesQuery = useQuery({
    queryKey: ["payees", walletId],
    queryFn: () => listPayees(walletId),
  });
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const tagsQuery = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });
  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const invalidateTemplates = () =>
    void qc.invalidateQueries({ queryKey: ["templates", walletId] });

  // Filters live in the URL query string so they round-trip and are shareable.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const setFilters = (f: typeof filters) => setSearchParams(filtersToParams(f), { replace: true });
  const filteredRows = useMemo(
    () => applyFilters(rows, filters, categoriesQuery.data ?? []),
    [rows, filters, categoriesQuery.data],
  );

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

  // Selection (for multi-edit and reconcile) + reconcile mode.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [reconcile, setReconcile] = useState(false);
  useEffect(() => {
    // Switching account resets transient selection/reconcile state.
    setSelected(new Set());
    setReconcile(false);
  }, [accountId]);
  const toggleSelect = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = (ids: number[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  const clearSelection = () => setSelected(new Set());

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
  const bulk = useMutation({
    mutationFn: (v: { ids: number[]; field: BulkField; value: number | null }) =>
      bulkEditTransactions(walletId, v.ids, v.field, v.value),
    onSuccess: (res) => {
      invalidate();
      clearSelection();
      notifications.show({ color: "green", message: t("bulk.done", { count: res.updated }) });
    },
    onError,
  });

  // Reconciled rows are locked: editing or deleting one requires an explicit
  // unreconcile first.
  const RECONCILED = 2;
  const editRow = (row: RegisterRow) => {
    if (row.status === RECONCILED && !window.confirm(t("reconcile.lockedEdit"))) return;
    if (row.transferId != null) {
      setEditingTransferId(row.transferId);
      transferForm.open();
    } else {
      setEditing(row);
      form.open();
    }
  };
  const deleteRow = (row: RegisterRow) => {
    if (row.status === RECONCILED && !window.confirm(t("reconcile.lockedDelete"))) return;
    if (row.transferId != null) {
      if (window.confirm(t("transfers.confirmDelete"))) removeTransfer.mutate(row.transferId);
    } else if (window.confirm(t("transactions.confirmDelete"))) {
      remove.mutate(row.id);
    }
  };

  const saveTemplateFromRow = useMutation({
    mutationFn: (v: { id: number; name: string }) =>
      createTemplateFromTransaction(walletId, v.id, v.name),
    onSuccess: () => {
      invalidateTemplates();
      notifications.show({ color: "green", message: t("templates.saved") });
    },
    onError,
  });
  const templateFromRow = (row: RegisterRow) => {
    const name = window.prompt(t("templates.namePrompt"));
    if (name && name.trim()) saveTemplateFromRow.mutate({ id: row.id, name: name.trim() });
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
            variant={reconcile ? "filled" : "default"}
            leftSection={<IconChecklist size={16} />}
            disabled={!account}
            onClick={() => {
              clearSelection();
              setReconcile((v) => !v);
            }}
          >
            {t("reconcile.start")}
          </Button>
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

      {account && reconcile && (
        <ReconcilePanel
          account={account}
          rows={rows}
          selected={selected}
          fmt={fmt}
          onFinish={() => {
            const ids = [...selected];
            if (ids.length > 0) bulk.mutate({ ids, field: "status", value: 2 });
            setReconcile(false);
          }}
          onCancel={() => {
            clearSelection();
            setReconcile(false);
          }}
        />
      )}

      {account && !reconcile && (
        <RegisterFilters
          filters={filters}
          onChange={setFilters}
          payees={payeesQuery.data ?? []}
          categories={categoriesQuery.data ?? []}
          tags={tagsQuery.data ?? []}
          fmt={fmt}
        />
      )}

      {account && !reconcile && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          payees={payeesQuery.data ?? []}
          categories={categoriesQuery.data ?? []}
          loading={bulk.isPending}
          onApply={(field, value) => bulk.mutate({ ids: [...selected], field, value })}
          onClear={clearSelection}
        />
      )}

      {account && !reconcile && (
        <QuickAdd walletId={walletId} account={account} onAdded={invalidate} onError={onError} />
      )}

      {account && filteredRows.length === 0 && <Text c="dimmed">{t("transactions.empty")}</Text>}

      {account && filteredRows.length > 0 && (
        <RegisterTable
          rows={filteredRows}
          accounts={accounts}
          fmt={fmt}
          selected={selected}
          onToggleSelect={toggleSelect}
          onToggleAll={toggleAll}
          onEdit={editRow}
          onDelete={deleteRow}
          onToggleStatus={(row, status) => toggleStatus.mutate({ id: row.id, status })}
          onSaveTemplate={templateFromRow}
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
          templates={templates.filter((tpl) => !tpl.isTransfer)}
          onTemplateSaved={invalidateTemplates}
        />
      )}

      <TransferForm
        opened={transferOpened}
        onClose={transferForm.close}
        walletId={walletId}
        accounts={accounts}
        editingId={editingTransferId}
        onSaved={invalidate}
        templates={templates.filter((tpl) => tpl.isTransfer)}
        onTemplateSaved={invalidateTemplates}
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

// BulkBar applies one field to every selected transaction in a single atomic
// request (all-or-nothing, server-side).
function BulkBar({
  count,
  payees,
  categories,
  loading,
  onApply,
  onClear,
}: {
  count: number;
  payees: Payee[];
  categories: Category[];
  loading: boolean;
  onApply: (field: BulkField, value: number | null) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [field, setField] = useState<BulkField>("status");
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => setValue(null), [field]);

  const categoryOptions = categories.map((c) => ({
    value: String(c.id),
    label: c.parentId
      ? `   ${categories.find((p) => p.id === c.parentId)?.name ?? ""} › ${c.name}`
      : c.name,
  }));
  const valueProps = { value, onChange: setValue, w: 200, searchable: true } as const;
  let valueControl;
  if (field === "status") {
    valueControl = (
      <Select
        {...valueProps}
        placeholder={t("transactions.status")}
        data={STATUSES.map((s) => ({ value: String(s), label: t(`status.${s}`) }))}
      />
    );
  } else if (field === "paymentMode") {
    valueControl = (
      <Select
        {...valueProps}
        placeholder={t("transactions.paymentMode")}
        data={PAYMENT_MODES.map((m) => ({ value: String(m), label: t(`paymentModes.${m}`) }))}
      />
    );
  } else if (field === "category") {
    valueControl = (
      <Select
        {...valueProps}
        clearable
        placeholder={t("transactions.category")}
        data={categoryOptions}
      />
    );
  } else {
    valueControl = (
      <Select
        {...valueProps}
        clearable
        placeholder={t("transactions.payee")}
        data={payees.map((p) => ({ value: String(p.id), label: p.name }))}
      />
    );
  }
  // status/paymentMode need a value; category/payee may be cleared (null).
  const canApply = field === "category" || field === "payee" || value !== null;

  return (
    <Card withBorder padding="xs" bg="var(--mantine-color-blue-light)">
      <Group gap="xs" align="flex-end">
        <Text fw={500}>{t("bulk.title", { count })}</Text>
        <Select
          label={t("bulk.field")}
          data={(["status", "category", "payee", "paymentMode"] as BulkField[]).map((f) => ({
            value: f,
            label: t(`bulk.fields.${f}`),
          }))}
          value={field}
          onChange={(v) => setField((v as BulkField) ?? "status")}
          allowDeselect={false}
          w={150}
        />
        {valueControl}
        <Button
          onClick={() => onApply(field, value === null ? null : Number(value))}
          loading={loading}
          disabled={!canApply}
        >
          {t("bulk.apply")}
        </Button>
        <Button variant="subtle" color="gray" onClick={onClear}>
          {t("bulk.clearSelection")}
        </Button>
      </Group>
    </Card>
  );
}

// ReconcilePanel drives the reconcile workflow: enter the statement balance,
// tick rows (checkboxes in the register) until the difference is zero, then
// finish to mark them reconciled.
function ReconcilePanel({
  account,
  rows,
  selected,
  fmt,
  onFinish,
  onCancel,
}: {
  account: Account;
  rows: RegisterRow[];
  selected: Set<number>;
  fmt: MoneyFormat;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const [statement, setStatement] = useState("");
  const statementMinor = parseAmount(
    statement,
    account.currencyFracDigits,
    account.currencyDecimalChar,
  );
  // Cleared balance = initial + amounts already reconciled or ticked this session.
  const clearedBalance = rows.reduce(
    (s, r) => (r.status === 2 || selected.has(r.id) ? s + r.amount : s),
    account.initialBalance,
  );
  const diff = statementMinor === null ? null : statementMinor - clearedBalance;

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="lg">
          <TextInput
            label={t("reconcile.statementBalance")}
            value={statement}
            onChange={(e) => setStatement(e.currentTarget.value)}
            w={170}
            rightSection={<Text size="xs">{account.currencyCode}</Text>}
          />
          <div>
            <Text size="xs" c="dimmed" tt="uppercase">
              {t("reconcile.clearedBalance")}
            </Text>
            <Text fw={600}>{formatMinor(clearedBalance, fmt)}</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase">
              {t("reconcile.difference")}
            </Text>
            <Text fw={700} c={diff === null ? undefined : diff === 0 ? "teal" : "red"}>
              {diff === null ? "—" : formatMinor(diff, fmt)}
            </Text>
          </div>
        </Group>
        <Group>
          <Button variant="default" onClick={onCancel}>
            {t("reconcile.cancel")}
          </Button>
          <Button color="teal" disabled={selected.size === 0} onClick={onFinish}>
            {t("reconcile.finish", { count: selected.size })}
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        {t("reconcile.help")}
      </Text>
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
  templates,
  onTemplateSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  account: Account;
  editing: Transaction | null;
  onSaved: () => void;
  templates: Template[];
  onTemplateSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
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
  const totalMinor = (parseAmount(amount, fd, dc) ?? 0) * sign;
  const splitSumMinor = splits.reduce(
    (sum, s) => sum + (parseAmount(s.amount, fd, dc) ?? 0) * sign,
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
              amount: (parseAmount(s.amount, fd, dc) ?? 0) * sign,
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

  // Apply a template into the form (user reviews, then saves).
  const applyTemplate = (id: string | null) => {
    const tpl = templates.find((x) => String(x.id) === id);
    if (!tpl) return;
    setDirection(tpl.amount < 0 ? "expense" : "income");
    setAmount(tpl.amount !== 0 ? minorToInput(Math.abs(tpl.amount), fd, dc) : "");
    setPaymentMode(String(tpl.paymentMode));
    setStatus(String(tpl.status));
    setPayeeId(tpl.payeeId ? String(tpl.payeeId) : null);
    setCategoryId(tpl.categoryId ? String(tpl.categoryId) : null);
    setMemo(tpl.memo);
    setInfo(tpl.info);
    setTags(tpl.tags);
    setIsSplit(tpl.isSplit);
    setSplits(
      tpl.splits?.map((s) => ({
        categoryId: s.categoryId ? String(s.categoryId) : null,
        amount: minorToInput(Math.abs(s.amount), fd, dc),
      })) ?? [],
    );
  };

  const saveTemplate = useMutation({
    mutationFn: (name: string) =>
      createTemplate(walletId, {
        name,
        accountId: account.id,
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
              amount: (parseAmount(s.amount, fd, dc) ?? 0) * sign,
            }))
          : [],
      }),
    onSuccess: () => {
      onTemplateSaved();
      notifications.show({ color: "green", message: t("templates.saved") });
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

  // Apply-on-manual: when adding a transaction, the first matching rule fills
  // any empty payee/category/payment-mode fields (the user can still override).
  const runSuggest = async () => {
    if (editing) return;
    const name = (payeesQuery.data ?? []).find((p) => String(p.id) === payeeId)?.name ?? "";
    if (!memo.trim() && !name) return;
    try {
      const res = await suggestAssignment(walletId, memo, name);
      if (!res.matched) return;
      if (!payeeId && res.payeeId != null) setPayeeId(String(res.payeeId));
      if (!isSplit && !categoryId && res.categoryId != null) setCategoryId(String(res.categoryId));
      if (paymentMode === "0" && res.paymentMode != null) setPaymentMode(String(res.paymentMode));
    } catch {
      // suggestion is best-effort; ignore failures
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={editing ? t("transactions.editTitle") : t("transactions.addTitle")}
    >
      <Stack>
        {!editing && templates.length > 0 && (
          <Select
            label={t("templates.apply")}
            placeholder={t("templates.applyPlaceholder")}
            data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
            onChange={applyTemplate}
            searchable
            clearable
          />
        )}
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
          onBlur={() => void runSuggest()}
        />
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconDeviceFloppy size={16} />}
            loading={saveTemplate.isPending}
            disabled={totalMinor === 0 && !isSplit}
            onClick={() => {
              const name = window.prompt(t("templates.namePrompt"));
              if (name && name.trim()) saveTemplate.mutate(name.trim());
            }}
          >
            {t("templates.saveAs")}
          </Button>
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
  templates,
  onTemplateSaved,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  accounts: Account[];
  editingId: number | null;
  onSaved: () => void;
  templates: Template[];
  onTemplateSaved: () => void;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();

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
    ? (parseAmount(fromAmount, fromAccount.currencyFracDigits, fromAccount.currencyDecimalChar) ??
      0)
    : 0;
  const toMinor = toAccount
    ? (parseAmount(toAmount, toAccount.currencyFracDigits, toAccount.currencyDecimalChar) ?? 0)
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

  // Apply a transfer template: pre-fill from/to accounts, amount and memo.
  const applyTemplate = (id: string | null) => {
    const tpl = templates.find((x) => String(x.id) === id);
    if (!tpl || tpl.accountId == null || tpl.toAccountId == null) return;
    const from = accounts.find((a) => a.id === tpl.accountId);
    const to = accounts.find((a) => a.id === tpl.toAccountId);
    setFromId(String(tpl.accountId));
    setToId(String(tpl.toAccountId));
    setMemo(tpl.memo);
    setStatus(String(tpl.status));
    const mag = Math.abs(tpl.amount);
    if (from) setFromAmount(minorToInput(mag, from.currencyFracDigits, from.currencyDecimalChar));
    if (to) setToAmount(minorToInput(mag, to.currencyFracDigits, to.currencyDecimalChar));
  };

  const saveTemplate = useMutation({
    mutationFn: (name: string) =>
      createTemplate(walletId, {
        name,
        isTransfer: true,
        accountId: fromId ? Number(fromId) : null,
        toAccountId: toId ? Number(toId) : null,
        amount: -fromMinor,
        memo,
        status: Number(status),
      }),
    onSuccess: () => {
      onTemplateSaved();
      notifications.show({ color: "green", message: t("templates.saved") });
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
        {editingId == null && templates.length > 0 && (
          <Select
            label={t("templates.apply")}
            placeholder={t("templates.applyPlaceholder")}
            data={templates.map((tpl) => ({ value: String(tpl.id), label: tpl.name }))}
            onChange={applyTemplate}
            searchable
            clearable
          />
        )}
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
        <Group justify="space-between">
          <Button
            variant="subtle"
            color="gray"
            leftSection={<IconDeviceFloppy size={16} />}
            loading={saveTemplate.isPending}
            disabled={!fromId || !toId || fromId === toId || fromMinor <= 0}
            onClick={() => {
              const name = window.prompt(t("templates.namePrompt"));
              if (name && name.trim()) saveTemplate.mutate(name.trim());
            }}
          >
            {t("templates.saveAs")}
          </Button>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("transactions.cancel")}
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={invalid}>
              {t("transactions.save")}
            </Button>
          </Group>
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
