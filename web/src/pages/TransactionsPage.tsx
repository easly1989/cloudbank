import {
  Badge,
  Button,
  Card,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowsExchange,
  IconChecklist,
  IconFilterOff,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  ApiError,
  type Account,
  type BulkField,
  type RegisterRow,
  type Transaction,
  bulkDeleteTransactions,
  bulkEditTransactions,
  bulkTagTransactions,
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
import { useToday } from "../useToday";
import { BulkEditModal } from "../components/BulkEditModal";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { QuickAdd } from "../components/QuickAdd";
import { TransactionForm } from "../components/TransactionForm";
import { TransferForm } from "../components/TransferForm";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterFilters } from "./RegisterFilters";
import { RegisterTable } from "./RegisterTable";
import {
  activeFilterCount,
  applyFilters,
  emptyFilters,
  filtersToParams,
  isActive,
  parseFilters,
} from "./registerFilters";

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
  // Preselect the account named in ?account= (e.g. a deep link from global
  // search); otherwise fall back to the first account.
  const [accountId, setAccountId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("account"),
  );
  useEffect(() => {
    if (accounts.length === 0) return;
    const valid = accountId != null && accounts.some((a) => String(a.id) === accountId);
    if (!valid) setAccountId(String(accounts[0].id));
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

  // Filters live in the URL query string so they round-trip and are shareable,
  // and are mirrored to localStorage (per wallet) so leaving the page and coming
  // back restores them instead of resetting to empty.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const filtersKey = `cb.reg.filters.${walletId}`;
  const setFilters = (f: typeof filters) => {
    const params = filtersToParams(f);
    setSearchParams(params, { replace: true });
    try {
      localStorage.setItem(filtersKey, new URLSearchParams(params).toString());
    } catch {
      /* storage unavailable — URL still carries the filters this session */
    }
  };
  // On (re)mount, if the URL carries no filters (e.g. arrived via the sidebar,
  // not a deep link like ?unc=1), restore the last-used filters for this wallet.
  const restored = useRef(false);
  useEffect(() => {
    if (walletId <= 0 || restored.current) return;
    restored.current = true;
    if (isActive(filters)) return; // an explicit URL/deep link wins
    try {
      const saved = localStorage.getItem(filtersKey);
      if (saved) {
        const params = new URLSearchParams(saved);
        if ([...params.keys()].length > 0) setSearchParams(params, { replace: true });
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  // The block above the ledger; the ledger fills the viewport down from its
  // bottom, so collapsing a section here hands its space to the ledger.
  const topRef = useRef<HTMLDivElement>(null);
  // `today` (reactive) is only a recompute trigger here: including it in the deps
  // makes `hideFuture` re-evaluate when the day rolls over while the page stays
  // open (even with no other change), at which point applyFilters' own `new
  // Date()` default is fresh. Passing a synthetic date instead would shift the
  // preset bounds by a day in western timezones, so we don't.
  const today = useToday();
  const filteredRows = useMemo(
    () => applyFilters(rows, filters, categoriesQuery.data ?? []),
    // `today` is an intentional recompute trigger, not read inside the callback.
    [rows, filters, categoriesQuery.data, today], // eslint-disable-line react-hooks/exhaustive-deps
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
  const [duplicating, setDuplicating] = useState<Transaction | null>(null);
  const [transferOpened, transferForm] = useDisclosure(false);
  const [editingTransferId, setEditingTransferId] = useState<number | null>(null);

  // Selection (for multi-edit and reconcile) + reconcile mode.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
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
      setBulkEditOpen(false);
      notifications.show({ color: "green", message: t("bulk.done", { count: res.updated }) });
    },
    onError,
  });
  const bulkDelete = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteTransactions(walletId, ids),
    onSuccess: (res) => {
      invalidate();
      clearSelection();
      notifications.show({ color: "green", message: t("bulk.deleted", { count: res.deleted }) });
    },
    onError,
  });
  const bulkTags = useMutation({
    mutationFn: (v: { ids: number[]; tags: string[]; replace: boolean }) =>
      bulkTagTransactions(walletId, v.ids, v.tags, v.replace),
    onSuccess: (res) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["tags", walletId] });
      clearSelection();
      setBulkEditOpen(false);
      notifications.show({ color: "green", message: t("bulk.done", { count: res.updated }) });
    },
    onError,
  });
  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (window.confirm(t("bulk.confirmDelete", { count: ids.length }))) bulkDelete.mutate(ids);
  };

  // Reconciled rows are locked: editing or deleting one requires an explicit
  // unreconcile first.
  const RECONCILED = 2;
  const editRow = (row: RegisterRow) => {
    if (row.status === RECONCILED && !window.confirm(t("reconcile.lockedEdit"))) return;
    if (row.transferId != null) {
      setEditingTransferId(row.transferId);
      transferForm.open();
    } else {
      setDuplicating(null);
      setEditing(row);
      form.open();
    }
  };
  // Duplicate: open the entry form pre-filled from the row as a NEW transaction.
  const duplicateRow = (row: RegisterRow) => {
    if (row.transferId != null) return; // transfers aren't duplicated here
    setEditing(null);
    setDuplicating(row);
    form.open();
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
      <Stack ref={topRef} gap="md">
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
                setDuplicating(null);
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
          <CollapsibleSection
            title={t("register.balances")}
            storageKey="cb.reg.balances"
            summary={
              <Text size="xs" truncate>
                {t("register.bank")} {formatMinor(registerQuery.data.summary.bank, fmt)} ·{" "}
                {t("register.today")} {formatMinor(registerQuery.data.summary.today, fmt)} ·{" "}
                {t("register.future")} {formatMinor(registerQuery.data.summary.future, fmt)}
              </Text>
            }
          >
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <BalanceCard
                label={t("register.bank")}
                help={t("register.bankHelp")}
                value={registerQuery.data.summary.bank}
                fmt={fmt}
              />
              <BalanceCard
                label={t("register.today")}
                help={t("register.todayHelp")}
                value={registerQuery.data.summary.today}
                fmt={fmt}
              />
              <BalanceCard
                label={t("register.future")}
                help={t("register.futureHelp")}
                value={registerQuery.data.summary.future}
                fmt={fmt}
              />
            </SimpleGrid>
          </CollapsibleSection>
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
          <CollapsibleSection
            title={t("filters.section")}
            storageKey="cb.reg.tools"
            summary={
              activeFilterCount(filters) > 0 ? (
                <Badge size="sm" variant="light" aria-label={t("filters.activeCount")}>
                  {activeFilterCount(filters)}
                </Badge>
              ) : undefined
            }
            action={
              activeFilterCount(filters) > 0 ? (
                <Button
                  variant="light"
                  color="gray"
                  size="xs"
                  leftSection={<IconFilterOff size={14} />}
                  onClick={() => setFilters(emptyFilters)}
                >
                  {t("filters.clear")}
                </Button>
              ) : undefined
            }
          >
            <Stack gap="xs">
              <RegisterFilters
                filters={filters}
                onChange={setFilters}
                payees={payeesQuery.data ?? []}
                categories={categoriesQuery.data ?? []}
                tags={tagsQuery.data ?? []}
                fmt={fmt}
              />
              <QuickAdd
                walletId={walletId}
                account={account}
                onAdded={invalidate}
                onError={onError}
              />
            </Stack>
          </CollapsibleSection>
        )}

        {/* Selection actions stay outside the collapsible so they remain reachable
          even when filters/entry are folded away. */}
        {account && !reconcile && selected.size > 0 && (
          <BulkBar
            count={selected.size}
            total={selectionTotals.total}
            inflow={selectionTotals.inflow}
            outflow={selectionTotals.outflow}
            fmt={fmt}
            onEdit={() => setBulkEditOpen(true)}
            onDelete={deleteSelected}
            onClear={clearSelection}
          />
        )}

        {account && filteredRows.length === 0 && <Text c="dimmed">{t("transactions.empty")}</Text>}
      </Stack>

      {account && filteredRows.length > 0 && (
        <RegisterTable
          rows={filteredRows}
          accounts={accounts}
          fmt={fmt}
          selected={selected}
          onToggleSelect={toggleSelect}
          onToggleAll={toggleAll}
          onEdit={editRow}
          onDuplicate={duplicateRow}
          onDelete={deleteRow}
          onToggleStatus={(row, status) => toggleStatus.mutate({ id: row.id, status })}
          onSaveTemplate={templateFromRow}
          onBulkEdit={() => setBulkEditOpen(true)}
          onBulkDelete={deleteSelected}
          fillRef={topRef}
        />
      )}

      <BulkEditModal
        opened={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        count={selected.size}
        payees={payeesQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        tags={tagsQuery.data ?? []}
        loading={bulk.isPending || bulkTags.isPending}
        onApply={(field, value) => bulk.mutate({ ids: [...selected], field, value })}
        onApplyTags={(tags, replace) => bulkTags.mutate({ ids: [...selected], tags, replace })}
      />

      {account && (
        <TransactionForm
          opened={formOpened}
          onClose={() => {
            form.close();
            setDuplicating(null);
          }}
          walletId={walletId}
          account={account}
          editing={editing}
          duplicate={duplicating}
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

function BalanceCard({
  label,
  value,
  fmt,
  help,
}: {
  label: string;
  value: number;
  fmt: MoneyFormat;
  help?: string;
}) {
  return (
    <Card withBorder padding="sm">
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" tt="uppercase">
          {label}
        </Text>
        {help && (
          <Tooltip label={help} multiline w={240} withArrow>
            <IconInfoCircle size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
          </Tooltip>
        )}
      </Group>
      <Text size="lg" fw={600} c={value < 0 ? "red" : undefined}>
        {formatMinor(value, fmt)}
      </Text>
    </Card>
  );
}

// BulkBar summarises the current selection and opens the bulk editor or a bulk
// delete for every selected transaction (the same actions are also on the
// register's right-click menu).
function BulkBar({
  count,
  total,
  inflow,
  outflow,
  fmt,
  onEdit,
  onDelete,
  onClear,
}: {
  count: number;
  total: number;
  inflow: number;
  outflow: number;
  fmt: MoneyFormat;
  onEdit: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder padding="xs" bg="var(--mantine-color-blue-light)">
      <Group gap="xs" align="center" wrap="wrap">
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
        <Group gap="xs" ml="auto" wrap="nowrap">
          <Button size="xs" variant="light" leftSection={<IconPencil size={14} />} onClick={onEdit}>
            {t("bulk.edit")}
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={onDelete}
          >
            {t("bulk.delete")}
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={onClear}>
            {t("bulk.clearSelection")}
          </Button>
        </Group>
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
