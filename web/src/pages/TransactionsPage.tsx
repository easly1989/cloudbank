import {
  ActionIcon,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconEye,
  IconEyeOff,
  IconArrowUp,
  IconArrowsExchange,
  IconChecklist,
  IconInfoCircle,
  IconDots,
  IconFileImport,
  IconPlus,
  IconSelector,
  IconWallet,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Link, useSearchParams } from "react-router-dom";

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
import { useConfirm } from "../components/confirmContext";
import { BulkEditModal } from "../components/BulkEditModal";
import { TransactionForm } from "../components/TransactionForm";
import { TransferForm } from "../components/TransferForm";
import { useWallet } from "../wallet/WalletProvider";
import { useAuth } from "../auth/AuthProvider";
import { RegisterFilters } from "./RegisterFilters";
import { RegisterTable } from "./RegisterTable";
import { RegisterToolbar, type RegisterPanel } from "./RegisterToolbar";
import {
  applyFilters,
  hiddenNewerCount,
  emptyFilters,
  filtersToParams,
  isActive,
  parseFilters,
} from "./registerFilterModel";
import { amountColor, attentionColor, errorColor, negativeOnlyColor } from "../amountTone";
import { pickBalances, type BalanceKey } from "../components/dashboard/overviewFigureModel";
import { arrival, useArrival, useCountUp, type Arrival } from "../motion";
import { BAND_INSET, BAND_PADDING, ROW_GAP, ROW_TYPE } from "./registerTheme";

// The three figures, and where each name and explanation live.
const BALANCE_LABEL: Record<BalanceKey, string> = {
  bank: "register.bank",
  today: "register.today",
  future: "register.future",
};
const BALANCE_HELP: Record<BalanceKey, string> = {
  bank: "register.bankHelp",
  today: "register.todayHelp",
  future: "register.futureHelp",
};

export function TransactionsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const { user } = useAuth();
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

  // The row that was just saved, and for how long it stays marked. A saved
  // transaction lands wherever the date order puts it, which on a long register
  // is often nowhere near where the reader was looking.
  const [savedMark, setSavedMark] = useState<Arrival | null>(null);
  const arrived = useArrival(savedMark);

  const invalidate = (id?: number) => {
    void qc.invalidateQueries({ queryKey: ["register", walletId, accountId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
    if (id != null) setSavedMark(arrival(id));
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const balances = pickBalances(user?.preferences?.registerBalances);
  // Filters and columns share one side panel: two of them open at once would
  // leave the ledger a strip down the middle.
  const [panel, setPanel] = useState<RegisterPanel>(null);

  // "N" starts a new transaction. A ledger is somewhere people type, so the
  // shortcut stands down whenever a field, a menu or the sheet already has the
  // keyboard — otherwise typing "n" into a memo would open a second form.
  useHotkeys([["n", () => !formOpened && !transferOpened && !reconcile && form.open()]]);

  const [formOpened, form] = useDisclosure(false);

  const [editing, setEditing] = useState<Transaction | null>(null);
  const [duplicating, setDuplicating] = useState<Transaction | null>(null);

  // ?new=1 opens the entry sheet on arrival, so the overview's "Add
  // transaction" can hand the reader straight to it rather than growing a
  // second entry form of its own — entering a transaction is work you do beside
  // the ledger, which is the whole argument for the sheet.
  //
  // The parameter is read, not copied into state: an effect that mirrors the
  // URL into a flag has two sources of truth and renders twice to reconcile
  // them.
  const openNew = searchParams.get("new") === "1";
  const clearNew = () => {
    if (!openNew) return;
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  };
  const [transferOpened, transferForm] = useDisclosure(false);
  const [editingTransferId, setEditingTransferId] = useState<number | null>(null);

  // Selection (for multi-edit and reconcile) + reconcile mode.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // Deliberately not a saved preference: hiding figures is something you turn on
  // for a moment to take a screenshot, not a mode to wake up in.
  const [privacy, setPrivacy] = useState(false);
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
  // What the current filter is keeping off the top of the ledger. See
  // hiddenNewerCount: a filtered register whose newest line is weeks old looks
  // like the balance has drifted, and it hasn't.
  const hiddenNewer = useMemo(() => hiddenNewerCount(rows, filteredRows), [rows, filteredRows]);

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
    onSuccess: () => invalidate(),
    onError,
  });
  const removeTransfer = useMutation({
    mutationFn: (id: number) => deleteTransfer(walletId, id),
    onSuccess: () => invalidate(),
    onError,
  });
  const toggleStatus = useMutation({
    mutationFn: (v: { id: number; status: number }) =>
      setTransactionStatus(walletId, v.id, v.status),
    onSuccess: () => invalidate(),
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
  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm({
      title: t("bulk.confirmDeleteTitle", { count: ids.length }),
      body: t("bulk.confirmDeleteBody"),
      confirmLabel: t("bulk.confirmDeleteAction"),
      cancelLabel: t("bulk.confirmDeleteKeep", { count: ids.length }),
      danger: true,
    });
    if (ok) bulkDelete.mutate(ids);
  };

  // Reconciled rows are locked: editing or deleting one requires an explicit
  // unreconcile first.
  const RECONCILED = 2;
  const editRow = async (row: RegisterRow) => {
    if (
      row.status === RECONCILED &&
      !(await confirm({
        title: t("reconcile.lockedEditTitle"),
        body: t("reconcile.lockedEdit"),
        confirmLabel: t("reconcile.lockedEditAction"),
      }))
    )
      return;
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
  const deleteRow = async (row: RegisterRow) => {
    if (
      row.status === RECONCILED &&
      !(await confirm({
        title: t("reconcile.lockedDeleteTitle"),
        body: t("reconcile.lockedDelete"),
        confirmLabel: t("reconcile.lockedDeleteAction"),
        danger: true,
      }))
    )
      return;
    if (row.transferId != null) {
      const ok = await confirm({
        title: t("transfers.confirmDeleteTitle"),
        // A transfer is two rows; deleting it removes both, which is the part
        // people do not expect.
        body: t("transfers.confirmDeleteBody"),
        confirmLabel: t("transfers.confirmDeleteAction"),
        danger: true,
      });
      if (ok) removeTransfer.mutate(row.transferId);
      return;
    }
    const ok = await confirm({
      title: t("transactions.confirmDeleteTitle"),
      body: t("transactions.confirmDeleteBody"),
      confirmLabel: t("transactions.confirmDeleteAction"),
      danger: true,
    });
    if (ok) remove.mutate(row.id);
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
    <Stack className={privacy ? "cb-private" : undefined}>
      <Stack ref={topRef} gap="md">
        {/* The account is the title. The register is about one account, so
            naming the page "Transactions" and putting the account in a control
            beside it says the wrong thing twice; switching stays one click,
            because the title is the switch. */}
        <PageHeader
          title={
            <Menu position="bottom-start" withinPortal>
              <Menu.Target>
                <UnstyledButton
                  aria-label={t("transactions.account")}
                  disabled={accounts.length < 2}
                >
                  <Group gap={6} wrap="nowrap">
                    <Text inherit>{account?.name ?? t("transactions.title")}</Text>
                    {accounts.length > 1 && <IconSelector size={20} opacity={0.5} />}
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {accounts.map((a) => (
                  <Menu.Item
                    key={a.id}
                    onClick={() => setAccountId(String(a.id))}
                    fw={String(a.id) === accountId ? 700 : 400}
                  >
                    {a.name}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          }
          actions={
            <>
              {/* Reconciling, transferring and hiding figures are workflows, not
                  the headline actions of the page; they keep their own menu so
                  the two that matter stay the two you see. */}
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="default" size={36} aria-label={t("register.moreActions")}>
                    <IconDots size={18} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={privacy ? <IconEye size={16} /> : <IconEyeOff size={16} />}
                    onClick={() => setPrivacy((v) => !v)}
                  >
                    {t(privacy ? "register.privacy.show" : "register.privacy.hide")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconChecklist size={16} />}
                    disabled={!account}
                    onClick={() => {
                      clearSelection();
                      setReconcile((v) => !v);
                    }}
                  >
                    {t("reconcile.start")}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconArrowsExchange size={16} />}
                    disabled={accounts.length < 2}
                    onClick={() => {
                      setEditingTransferId(null);
                      transferForm.open();
                    }}
                  >
                    {t("transfers.add")}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <Button
                component={Link}
                to="/settings?tab=wallet&section=import"
                variant="default"
                leftSection={<IconFileImport size={16} />}
              >
                {t("register.import")}
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
            </>
          }
        />

        {accounts.length === 0 && (
          <EmptyState
            icon={IconWallet}
            message={t("transactions.noAccounts")}
            hint={t("transactions.noAccountsHint")}
            action={
              <Button component={Link} to="/accounts">
                {t("accounts.add")}
              </Button>
            }
          />
        )}

        {/* The same three figures the overview offers, and the same choice of
            which to show: "how much have I got" is one question asked in two
            places, so it should not have two answers. */}
        {account && registerQuery.data && (
          <Group gap="xl" align="flex-end" wrap="wrap">
            {balances.map((key, i) => (
              <BalanceFigure
                key={key}
                label={t(BALANCE_LABEL[key])}
                help={t(BALANCE_HELP[key])}
                value={registerQuery.data.summary[key]}
                fmt={fmt}
                lead={i === 0}
              />
            ))}
          </Group>
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
          <RegisterToolbar
            filters={filters}
            onFilters={setFilters}
            panel={panel}
            onPanel={setPanel}
            privacy={privacy}
            onPrivacy={setPrivacy}
          />
        )}

        {account && filteredRows.length === 0 && rows.length > 0 && (
          <EmptyState message={t("transactions.empty")} />
        )}
      </Stack>

      {/* Rendered even when the account is empty: the first row of the ledger
          is how a transaction gets into it. */}
      {account && (
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
          panel={panel}
          onPanel={setPanel}
          notice={
            hiddenNewer > 0 ? (
              <HiddenNotice count={hiddenNewer} onShow={() => setFilters(emptyFilters)} />
            ) : undefined
          }
          arrivedId={arrived}
          bulkBar={
            !reconcile && selected.size > 0 ? (
              <BulkBar
                count={selected.size}
                total={selectionTotals.total}
                fmt={fmt}
                onEdit={() => setBulkEditOpen(true)}
                onDelete={deleteSelected}
                onClear={clearSelection}
              />
            ) : undefined
          }
          onNew={
            reconcile
              ? undefined
              : () => {
                  setDuplicating(null);
                  setEditing(null);
                  form.open();
                }
          }
          filtersPanel={
            <RegisterFilters
              filters={filters}
              onChange={setFilters}
              payees={payeesQuery.data ?? []}
              categories={categoriesQuery.data ?? []}
              tags={tagsQuery.data ?? []}
              fmt={fmt}
            />
          }
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
          opened={formOpened || openNew}
          onClose={() => {
            form.close();
            clearNew();
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

/**
 * One of the register's three balances, read as a line rather than a tile.
 *
 * Today's balance leads at full size because it answers the question people
 * actually open the register with; the other two sit beside it in a smaller
 * size. They used to be three bordered cards in a collapsible block, which cost
 * a third of the screen above the ledger to say three numbers.
 */
function BalanceFigure({
  label,
  value,
  fmt,
  help,
  lead = false,
}: {
  label: string;
  value: number;
  fmt: MoneyFormat;
  help?: string;
  lead?: boolean;
}) {
  // The figure travels from its old value to its new one. A balance changes
  // because of something the reader just did — a filter, a saved row — and
  // seeing it move says so; a figure that simply swaps does not.
  const shown = useCountUp(value);
  return (
    <Stack gap={2}>
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        {help && (
          <Tooltip label={help} multiline w={240} withArrow>
            <IconInfoCircle size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
          </Tooltip>
        )}
      </Group>
      {/* Only the lead figure is in full-strength text: the others are context
          for it, and three equal figures would be three headlines. */}
      <Text
        ff="monospace"
        fw={lead ? 600 : 500}
        fz={lead ? 26 : 17}
        c={negativeOnlyColor(value) ?? (lead ? undefined : "dimmed")}
      >
        {formatMinor(shown, fmt)}
      </Text>
    </Stack>
  );
}

// BulkBar summarises the current selection and opens the bulk editor or a bulk
// delete for every selected transaction (the same actions are also on the
// register's right-click menu).
function BulkBar({
  count,
  total,
  fmt,
  onEdit,
  onDelete,
  onClear,
}: {
  count: number;
  total: number;
  fmt: MoneyFormat;
  onEdit: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    // The foot of the ledger, not a card floating above it: what is selected
    // and what it comes to, then what can be done about it.
    <Group
      gap={16}
      align="center"
      wrap="wrap"
      style={{
        padding: `${BAND_PADDING.bulk}px ${BAND_INSET}px`,
        background: "var(--cb-band-bulk)",
        borderTop: "1px solid var(--cb-ledger-border)",
      }}
    >
      <Text fz={ROW_TYPE.bulkLabel.fz} fw={ROW_TYPE.bulkLabel.fw}>
        {t("bulk.title", { count })}
      </Text>
      <Text ff="monospace" fz={ROW_TYPE.bulkSum.fz} fw={ROW_TYPE.bulkSum.fw} c={amountColor(total)}>
        {formatMinor(total, fmt)}
      </Text>
      <Group gap="xs" ml="auto" wrap="nowrap">
        <Button variant="default" size="compact-md" onClick={onEdit}>
          {t("bulk.edit")}
        </Button>
        <Button variant="default" size="compact-md" c={errorColor} onClick={onDelete}>
          {t("bulk.delete")}
        </Button>
        <Button variant="subtle" color="gray" size="compact-md" onClick={onClear}>
          {t("bulk.clear")}
        </Button>
      </Group>
    </Group>
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
            <Text
              fw={700}
              c={diff === null ? undefined : diff === 0 ? "var(--cb-positive)" : attentionColor}
            >
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

/**
 * What the filter is keeping out of sight.
 *
 * A filtered ledger whose newest line is weeks old reads as a balance that has
 * drifted, and it has not — so the register says so itself, in its own first
 * band, with the way back out of the filter right there.
 */
function HiddenNotice({ count, onShow }: { count: number; onShow: () => void }) {
  const { t } = useTranslation();
  return (
    <Group
      gap={ROW_GAP}
      wrap="nowrap"
      align="center"
      style={{
        padding: `${BAND_PADDING.hiddenNotice}px ${BAND_INSET}px`,
        background: "var(--cb-band-notice)",
        borderBottom: "1px solid var(--cb-ledger-border)",
      }}
    >
      <IconArrowUp size={15} style={{ flexShrink: 0 }} />
      <Text fz={13} style={{ flex: 1, minWidth: 0 }}>
        <Text span fw={600} inherit>
          {t("register.hiddenNewer.title", { count })}
        </Text>{" "}
        <Text span c="dimmed" inherit>
          {t("register.hiddenNewer.body")}
        </Text>
      </Text>
      <Button
        variant="default"
        h={34}
        fz={12}
        fw={500}
        px={11}
        onClick={onShow}
        style={{ flexShrink: 0 }}
      >
        {t("register.hiddenNewer.action")}
      </Button>
    </Group>
  );
}
