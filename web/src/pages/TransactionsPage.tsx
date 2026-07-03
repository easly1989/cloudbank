import {
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconArrowsExchange, IconChecklist, IconPlus } from "@tabler/icons-react";
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
  type Transaction,
  bulkEditTransactions,
  createTemplateFromTransaction,
  deleteTransaction,
  deleteTransfer,
  getRegister,
  listAccounts,
  listCategories,
  listPayees,
  listTags,
  listTemplates,
  setTransactionStatus,
} from "../api/client";
import { formatMinor, type MoneyFormat } from "../money";
import { useAmountParser } from "../useAmountParser";
import { QuickAdd } from "../components/QuickAdd";
import { TransactionForm } from "../components/TransactionForm";
import { TransferForm } from "../components/TransferForm";
import { PAYMENT_MODES, STATUSES } from "../transactionEnums";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterFilters } from "./RegisterFilters";
import { RegisterTable } from "./RegisterTable";
import { applyFilters, filtersToParams, parseFilters } from "./registerFilters";

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

  // Sum of the selected register rows (net, plus inflow/outflow split) so the
  // bulk bar can show a subtotal of the current selection (HomeBank-style).
  const selectionTotals = useMemo(() => {
    let total = 0;
    let inflow = 0;
    let outflow = 0;
    for (const r of rows) {
      if (!selected.has(r.id)) continue;
      total += r.amount;
      if (r.amount >= 0) inflow += r.amount;
      else outflow += r.amount;
    }
    return { total, inflow, outflow };
  }, [rows, selected]);

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
          total={selectionTotals.total}
          inflow={selectionTotals.inflow}
          outflow={selectionTotals.outflow}
          fmt={fmt}
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
  total,
  inflow,
  outflow,
  fmt,
  payees,
  categories,
  loading,
  onApply,
  onClear,
}: {
  count: number;
  total: number;
  inflow: number;
  outflow: number;
  fmt: MoneyFormat;
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
        <Group gap={6} align="baseline" wrap="nowrap">
          <Text size="xs" c="dimmed" tt="uppercase">
            {t("bulk.selectedTotal")}
          </Text>
          <Text fw={700} c={total < 0 ? "red" : total > 0 ? "teal" : undefined}>
            {formatMinor(total, fmt)}
          </Text>
          {inflow > 0 && outflow < 0 && (
            <Text size="xs" c="dimmed">
              ({t("bulk.selectedIn")} {formatMinor(inflow, fmt)} · {t("bulk.selectedOut")}{" "}
              {formatMinor(outflow, fmt)})
            </Text>
          )}
        </Group>
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
