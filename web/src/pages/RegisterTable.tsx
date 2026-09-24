import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Kbd,
  Menu,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconArrowsExchange,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconDeviceFloppy,
  IconLock,
  IconPaperclip,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  type LegacyColumnDef,
  legacyCreateColumnHelper as createColumnHelper,
  useLegacyTable as useReactTable,
} from "@tanstack/react-table/legacy";

// react-table v9 moved the v8 hook/column-helper API into its "/legacy"
// compatibility layer (same behavior, so the register keeps working unchanged).
// VisibilityState was the v8 name for the column-visibility map.
type VisibilityState = Record<string, boolean>;
type Column = LegacyColumnDef<RegisterRow>;
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import {
  type Preferences,
  updateMe,
  type Account,
  type RegisterRow,
  type User,
} from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useDateFormat } from "../dates";
import { todayCivil } from "../civilDate";
import { formatMinor, type MoneyFormat } from "../money";
import { stopRowEdit } from "../rowEdit";
import { ALL_COLUMNS, moveColumn, normalizeColumnOrder } from "./registerColumns";
import {
  BAND_INSET,
  BAND_PADDING,
  CATEGORY_DOT,
  ROW_ACTIONS_WIDTH,
  ROW_COLUMNS,
  DIVIDER_HEIGHT,
  ROW_GAP,
  ROW_SELECT_WIDTH,
  ROW_TYPE,
} from "./registerTheme";
import { RegisterSidePanel } from "./RegisterSidePanel";
import type { RegisterPanel } from "./RegisterToolbar";
import { isSortable, sortRegisterRows, type RegisterSort } from "./registerFilterModel";
import { useToday } from "../useToday";
import { amountColor, attentionColor, negativeOnlyColor } from "../amountTone";

// A row is 45 tall, and 59 when its lead column carries a second line — both
// measured off the tile. The virtualiser is told which, per row, so a ledger of
// payees-with-memos scrolls as smoothly as one without.
const ROW_HEIGHT = 45;
const ROW_HEIGHT_WITH_SUB = 59;
// Per-column grid widths (fixed so virtualized rows stay aligned). Status is
// wide enough for the longest label ("Non riconciliato") plus the lock glyph.
// Column widths come from the tile, not from taste: see registerTheme.ts and
// docs/design/register.json.
const COL_WIDTH = ROW_COLUMNS;
// Columns the privacy toggle blurs. Dates and status stay legible: they say
// nothing about you, and keeping the shape of the page readable is the point of
// the toggle — a screenshot should still show how CloudBank works.
// Narrower than this and a column stops being readable, so the drag stops.
const MIN_COL_WIDTH = 64;

const SENSITIVE_COLUMNS = new Set(["payee", "note", "amount", "runningBalance"]);

// Columns the user can show/hide, with their default visibility.
const TOGGLEABLE: { id: string; def: boolean }[] = [
  { id: "payee", def: true },
  { id: "category", def: true },
  { id: "note", def: false },
  { id: "status", def: true },
  { id: "runningBalance", def: true },
];
// i18n keys for the toggleable column labels (reuse existing strings).
const COL_LABEL: Record<string, string> = {
  // Date and amount cannot be hidden, but they can be moved, so they are named
  // here too — the panel lists every column, not just the optional ones.
  date: "transactions.date",
  amount: "transactions.amount",
  payee: "transactions.payee",
  category: "transactions.category",
  note: "transactions.memo",
  status: "transactions.status",
  runningBalance: "register.balance",
};
// Status badge colours indexed by status value (none..void).
const STATUS_COLORS = ["gray", "blue", "teal", "orange", "red"];
const STATUS_RECONCILED = 2;

export interface RegisterTableProps {
  rows: RegisterRow[];
  accounts: Account[];
  fmt: MoneyFormat;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  onToggleAll: (ids: number[], on: boolean) => void;
  onEdit: (row: RegisterRow) => void;
  onDuplicate: (row: RegisterRow) => void;
  onDelete: (row: RegisterRow) => void;
  onToggleStatus: (row: RegisterRow, status: number) => void;
  onSaveTemplate: (row: RegisterRow) => void;
  // Bulk actions on the current multi-selection (also on the selection bar);
  // shown in the right-click menu when more than one row is selected.
  onBulkEdit?: () => void;
  onBulkDelete?: () => void;
  // When provided, the ledger body grows to fill the viewport down from the
  // bottom of this element (the block above the table); collapsing sections above
  // reclaims their space for the ledger. Without it, a fixed height is used.
  fillRef?: React.RefObject<HTMLDivElement | null>;
  /** Which side panel is open, if any. */
  panel: RegisterPanel;
  onPanel: (p: RegisterPanel) => void;
  /** The filter controls, rendered inside the panel when it is showing them. */
  filtersPanel: ReactNode;
  /** Start a new transaction. Absent while reconciling, where entry is off. */
  onNew?: () => void;
  /** The selection bar, shown at the foot of the card whenever rows are picked. */
  bulkBar?: ReactNode;
  /** The band that explains what the filter is hiding, at the head of the card. */
  notice?: ReactNode;
  /** A row that has just been saved, marked until the tint fades. */
  arrivedId?: number | null;
}

// RegisterTable renders the account ledger newest-first with a chronological
// running balance, virtualized so very large accounts scroll smoothly. A
// checkbox column drives multi-edit and reconciliation. Reconciled rows show a
// lock glyph (edits go through an explicit unreconcile in the page).
// Keyboard: ↑/↓ move the selection cursor, Space toggles the checkbox, Enter
// edits, c/r toggle cleared/reconciled, Delete removes.
export function RegisterTable({
  rows,
  accounts,
  fmt,
  selected,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleStatus,
  onSaveTemplate,
  onBulkEdit,
  onBulkDelete,
  fillRef,
  panel,
  onPanel,
  filtersPanel,
  onNew,
  bulkBar,
  notice,
  arrivedId,
}: RegisterTableProps) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
  const parentRef = useRef<HTMLDivElement>(null);
  const [cursorId, setCursorId] = useState<number | null>(null);
  // Right-click context menu, anchored at the cursor position.
  const [menu, setMenu] = useState<{ x: number; y: number; row: RegisterRow } | null>(null);
  // Anchor row index for shift+click range selection (the last row toggled
  // without shift).
  const selectAnchorRef = useRef<number | null>(null);

  // Fill mode: size the scroll body so its bottom sits just above the footer,
  // recomputing whenever the block above (fillRef) changes size — e.g. an
  // accordion collapses or the bulk bar appears — and on window resize.
  const [bodyHeight, setBodyHeight] = useState<number>();
  const footRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!fillRef) return;
    const scroll = parentRef.current;
    if (!scroll) return;
    // Footer (36) + Main bottom padding (md=16) + a little breathing room.
    const BOTTOM_GAP = 56;
    const measure = () => {
      const top = scroll.getBoundingClientRect().top;
      // The selection bar sits below the body inside the same card, so the body
      // has to give up exactly its height. Without this the bar is pushed off
      // the bottom of the window the moment anything is selected, which is the
      // one thing a bar that summarises the selection must never do.
      const foot = footRef.current?.getBoundingClientRect().height ?? 0;
      setBodyHeight(Math.max(240, Math.round(window.innerHeight - top - BOTTOM_GAP - foot)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (fillRef.current) ro.observe(fillRef.current);
    if (footRef.current) ro.observe(footRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // bulkBar is in the deps because the foot appearing or leaving changes the
    // height the body may take, and it is the only signal that it did.
  }, [fillRef, bulkBar]);

  // Column visibility is a per-user preference; resolve defaults for any unset.
  const savedColumns = user?.preferences?.registerColumns;
  const columnVisibility = useMemo<VisibilityState>(() => {
    const v: VisibilityState = {};
    for (const c of TOGGLEABLE) v[c.id] = savedColumns?.[c.id] ?? c.def;
    return v;
  }, [savedColumns]);

  // Sorting and column widths are preferences too, so the register a user
  // arranged is the register they get back on another device.
  const sort = user?.preferences?.registerSort ?? null;
  const columnOrder = useMemo(
    () => normalizeColumnOrder(user?.preferences?.registerColumnOrder),
    [user?.preferences?.registerColumnOrder],
  );
  const savedWidths = user?.preferences?.registerColumnWidths;
  // Width being dragged right now: local, so a drag is not a PATCH per pixel.
  const [dragWidths, setDragWidths] = useState<Record<string, number> | null>(null);
  const widths = dragWidths ?? savedWidths ?? {};

  const persistPrefs = useMutation({
    mutationFn: (patch: Partial<Preferences>) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), ...patch } }),
    onSuccess: (updated: User) => qc.setQueryData(["me"], updated),
  });

  const toggleSort = (id: string) => {
    if (!isSortable(id)) return;
    // Click cycles ascending, descending, then back to the ledger's own order.
    const next = sort?.id !== id ? { id, desc: false } : sort.desc ? null : { id, desc: true };
    persistPrefs.mutate({ registerSort: next ?? undefined });
  };

  const persistColumns = useMutation({
    mutationFn: (next: VisibilityState) =>
      updateMe({
        preferences: {
          ...(user?.preferences ?? {}),
          registerColumns: next as Record<string, boolean>,
        },
      }),
    onSuccess: (updated: User) => qc.setQueryData(["me"], updated),
  });

  // Newest-first display; each row keeps its chronological running balance.
  // A chosen sort replaces that order, but never recomputes the balances: see
  // sortRegisterRows.
  const display = useMemo(() => sortRegisterRows([...rows].reverse(), sort), [rows, sort]);
  // Today's civil date (YYYY-MM-DD) for distinguishing future (scheduled) rows.
  // Reactive so a page left open past midnight stops mislabelling the new day's
  // rows as future without a manual reload.
  const todayStr = useToday();
  const accountName = useCallback(
    (id?: number | null) => accounts.find((a) => a.id === id)?.name,
    [accounts],
  );
  const allSelected = display.length > 0 && display.every((r) => selected.has(r.id));

  const columns = useMemo<Column[]>(() => {
    const col = createColumnHelper<RegisterRow>();
    // Heterogeneous column value types don't widen to the loose ColumnDef the
    // table expects, so assemble then cast — the standard react-table pattern.
    const defs = [
      col.accessor("date", {
        header: () => t("transactions.date"),
        cell: ({ getValue }) => {
          const date = getValue();
          if (date <= todayStr)
            return (
              <Text fz={ROW_TYPE.date.fz} style={{ whiteSpace: "nowrap" }}>
                {fmtDate(date)}
              </Text>
            );
          // Future-dated (scheduled) rows: a clock glyph and italic, dimmed date.
          return (
            <Group gap={4} wrap="nowrap" c="dimmed">
              <IconClock size={13} title={t("register.future")} />
              <Text fz={ROW_TYPE.date.fz} fs="italic" style={{ whiteSpace: "nowrap" }}>
                {fmtDate(date)}
              </Text>
            </Group>
          );
        },
      }),
      col.display({
        id: "payee",
        header: () => t("transactions.payee"),
        cell: ({ row }) => (
          <LeadCell
            lead={
              row.original.transferId != null
                ? (accountName(row.original.transferAccountId) ?? t("transfers.transfer"))
                : row.original.payeeName
            }
            icon={row.original.transferId != null ? <IconArrowsExchange size={14} /> : undefined}
            sub={leadSub("payee", row.original, t)}
          />
        ),
      }),
      col.display({
        id: "category",
        header: () => t("transactions.category"),
        cell: ({ row }) => {
          const uncategorised =
            row.original.transferId == null && !row.original.isSplit && !row.original.categoryName;
          return (
            <CategoryCell
              name={
                row.original.transferId != null
                  ? t("transfers.transfer")
                  : row.original.isSplit
                    ? t("transactions.split")
                    : (row.original.categoryName ?? t("review.uncategorised"))
              }
              uncategorised={uncategorised}
            />
          );
        },
      }),
      col.accessor("memo", {
        id: "note",
        header: () => t("transactions.memo"),
        cell: ({ getValue, row }) => (
          <LeadCell lead={getValue()} sub={leadSub("note", row.original, t)} />
        ),
      }),
      col.accessor("status", {
        id: "status",
        header: () => t("transactions.status"),
        cell: ({ row }) => (
          <Group gap={4} wrap="nowrap">
            <Badge
              variant="light"
              tt="none"
              color={STATUS_COLORS[row.original.status] ?? "gray"}
              style={{ cursor: "pointer" }}
              title={t("register.cycleStatus")}
              onClick={(e) => {
                e.stopPropagation();
                onToggleStatus(row.original, (row.original.status + 1) % STATUS_COLORS.length);
              }}
            >
              {t(`status.${row.original.status}`)}
            </Badge>
            {row.original.status === STATUS_RECONCILED && <IconLock size={12} opacity={0.5} />}
            {(row.original.attachmentCount ?? 0) > 0 && (
              <Group gap={1} wrap="nowrap" c="dimmed" title={t("attachments.count")}>
                <IconPaperclip size={13} />
                {(row.original.attachmentCount ?? 0) > 1 && (
                  <Text size="xs">{row.original.attachmentCount}</Text>
                )}
              </Group>
            )}
          </Group>
        ),
      }),
      col.accessor("amount", {
        header: () => <Box ta="right">{t("transactions.amount")}</Box>,
        cell: ({ row }) => (
          <Text size="sm" ta="right" c={amountColor(row.original.amount)}>
            {formatMinor(row.original.amount, fmt)}
          </Text>
        ),
      }),
      col.accessor("runningBalance", {
        header: () => <Box ta="right">{t("register.balance")}</Box>,
        cell: ({ row }) => (
          <Text size="sm" ta="right" fw={500} c={negativeOnlyColor(row.original.runningBalance)}>
            {formatMinor(row.original.runningBalance, fmt)}
          </Text>
        ),
      }),
    ];
    return defs as unknown as Column[];
  }, [t, fmt, fmtDate, accountName, onToggleStatus, todayStr]);

  const table = useReactTable({
    data: display,
    columns,
    state: { columnVisibility, columnOrder },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      persistColumns.mutate(next);
    },
    getCoreRowModel: getCoreRowModel(),
  });
  const tableRows = table.getRowModel().rows;

  // Build the grid template from the currently visible columns (checkbox +
  // visible data columns + actions), so hidden columns reclaim their space.
  const tracks = [
    ROW_SELECT_WIDTH,
    ...table
      .getVisibleLeafColumns()
      .map((c) => (widths[c.id] ? `${widths[c.id]}px` : (COL_WIDTH[c.id] ?? "minmax(100px, 1fr)"))),
    ROW_ACTIONS_WIDTH,
  ];
  const gridTemplate = tracks.join(" ");

  // The narrowest a row can be drawn without a column being squeezed out of
  // existence, which is also the width below which the ledger has to scroll
  // sideways.
  //
  // Rows are absolutely positioned inside the virtualiser, so they contribute
  // nothing to the scroll width: a row wider than the card was simply clipped,
  // and what fell off the right was the running balance. Deriving the figure
  // from the same tracks that draw the row means the two cannot disagree.
  const minRowWidth =
    tracks.reduce((sum, track) => sum + trackFloor(track), 0) +
    ROW_GAP * (tracks.length - 1) +
    BAND_INSET * 2;

  // Whether a row's lead column carries a second line, which decides its height.
  const baseRowHeight = useCallback(
    (index: number) => {
      const r = tableRows[index]?.original;
      if (!r) return ROW_HEIGHT;
      const leadIsPayee = table.getVisibleLeafColumns().some((c) => c.id === "payee");
      const hasSub = leadIsPayee ? !!r.memo : r.transferId == null && !r.isSplit && !r.categoryName;
      return hasSub ? ROW_HEIGHT_WITH_SUB : ROW_HEIGHT;
    },
    [tableRows, table],
  );

  // The row the reconciled block starts at, when the ledger runs newest first.
  //
  // Sorted any other way the line would be a lie — "up to here" only means
  // something along a date — so the divider simply does not appear. It is drawn
  // on top of its row rather than as an item of its own, which keeps every
  // index in this table the index of a transaction.
  const dividerIndex = useMemo(() => {
    if (sort && !(sort.id === "date" && sort.desc === false)) return -1;
    for (let i = 1; i < tableRows.length; i++) {
      if (
        tableRows[i].original.status === STATUS_RECONCILED &&
        tableRows[i - 1].original.status !== STATUS_RECONCILED
      )
        return i;
    }
    return -1;
  }, [tableRows, sort]);

  const rowHeight = useCallback(
    (index: number) => baseRowHeight(index) + (index === dividerIndex ? DIVIDER_HEIGHT : 0),
    [baseRowHeight, dividerIndex],
  );

  // The compiler will not memoize this component, because TanStack Virtual hands
  // back functions it cannot safely memoize. That is the trade: a register that
  // holds a decade of rows has to be virtualised, and one uncompiled component
  // is cheaper than rendering every row.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: rowHeight,
    overscan: 12,
  });

  const cursorIndex = useMemo(
    () => display.findIndex((r) => r.id === cursorId),
    [display, cursorId],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (display.length === 0) return;
    const move = (delta: number) => {
      const next = Math.min(
        Math.max(cursorIndex < 0 ? 0 : cursorIndex + delta, 0),
        display.length - 1,
      );
      setCursorId(display[next].id);
      virtualizer.scrollToIndex(next, { align: "auto" });
    };
    const sel = cursorIndex >= 0 ? display[cursorIndex] : null;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case " ":
        if (sel) {
          e.preventDefault();
          onToggleSelect(sel.id);
        }
        break;
      case "Enter":
        if (sel) {
          e.preventDefault();
          onEdit(sel);
        }
        break;
      case "c":
      case "C":
        if (sel) onToggleStatus(sel, sel.status === 1 ? 0 : 1);
        break;
      case "r":
      case "R":
        if (sel) onToggleStatus(sel, sel.status === STATUS_RECONCILED ? 0 : STATUS_RECONCILED);
        break;
      case "Delete":
      case "Backspace":
        if (sel) {
          e.preventDefault();
          onDelete(sel);
        }
        break;
    }
  };

  useEffect(() => {
    if (cursorId != null && !display.some((r) => r.id === cursorId)) setCursorId(null);
  }, [display, cursorId]);

  const columnsPanel = (
    <Stack gap={2}>
      {columnOrder.map((id, i) => {
        const toggleable = TOGGLEABLE.find((c) => c.id === id);
        return (
          <Group key={id} gap="xs" wrap="nowrap" justify="space-between">
            <Checkbox
              size="xs"
              // Date and amount cannot be hidden — a ledger without them is not
              // a ledger — but they can still be moved.
              disabled={!toggleable}
              checked={toggleable ? (columnVisibility[id] ?? toggleable.def) : true}
              onChange={() => toggleable && table.getColumn(id)?.toggleVisibility()}
              label={t(COL_LABEL[id])}
            />
            <Group gap={2} wrap="nowrap">
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                disabled={i === 0}
                aria-label={t("register.moveColumnLeft")}
                onClick={() =>
                  persistPrefs.mutate({ registerColumnOrder: moveColumn(columnOrder, id, -1) })
                }
              >
                <IconChevronUp size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="gray"
                disabled={i === columnOrder.length - 1}
                aria-label={t("register.moveColumnRight")}
                onClick={() =>
                  persistPrefs.mutate({ registerColumnOrder: moveColumn(columnOrder, id, 1) })
                }
              >
                <IconChevronDown size={14} />
              </ActionIcon>
            </Group>
          </Group>
        );
      })}
      <Group justify="flex-end" mt="xs" gap="xs">
        <Button
          variant="default"
          size="compact-sm"
          onClick={() =>
            persistPrefs.mutate({
              registerColumnOrder: [...ALL_COLUMNS],
              registerColumns: Object.fromEntries(TOGGLEABLE.map((c) => [c.id, c.def])),
            })
          }
        >
          {t("register.columnsReset")}
        </Button>
        <Button size="compact-sm" onClick={() => onPanel(null)}>
          {t("actions.done")}
        </Button>
      </Group>
    </Stack>
  );

  return (
    // The ledger and whichever panel is open sit side by side. Both panels used
    // to unfold above the rows, and everything they took they took from the one
    // thing on the page worth looking at. On the side they cost width, which a
    // ledger has to spare, rather than height, which it does not.
    <Group align="flex-start" wrap="wrap" gap="md">
      <Box
        style={{
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
          // The ledger is a card, and every band below sits inside it.
          background: "var(--cb-ledger-surface)",
          border: "1px solid var(--cb-ledger-border)",
          borderRadius: "var(--mantine-radius-md)",
        }}
      >
        <Box style={{ minWidth: minRowWidth }}>
          {/* What the filter is hiding is said inside the ledger, because it is
              a fact about these rows and not a page-level announcement. */}
          {notice}
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: gridTemplate,
              gap: ROW_GAP,
              padding: `${BAND_PADDING.header}px ${BAND_INSET}px`,
              background: "var(--cb-band-header)",
              fontWeight: ROW_TYPE.header.fw,
              fontSize: ROW_TYPE.header.fz,
              borderBottom: "1px solid var(--cb-ledger-border)",
            }}
          >
            <Checkbox
              size="xs"
              aria-label={t("register.selectAll")}
              checked={allSelected}
              indeterminate={!allSelected && display.some((r) => selected.has(r.id))}
              onChange={(e) =>
                onToggleAll(
                  display.map((r) => r.id),
                  e.currentTarget.checked,
                )
              }
            />
            {table.getHeaderGroups()[0].headers.map((h) => (
              <ColumnHeader
                key={h.id}
                id={h.id}
                sort={sort}
                onSort={toggleSort}
                onResize={(width) => setDragWidths({ ...widths, [h.id]: width })}
                onResizeEnd={() => {
                  if (dragWidths) persistPrefs.mutate({ registerColumnWidths: dragWidths });
                  setDragWidths(null);
                }}
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
              </ColumnHeader>
            ))}
          </Box>
          {/* The way in is the first line of the ledger, where the next
              transaction will actually land — not a form above it. "N" is
              offered because a ledger is somewhere people type, and reaching
              for the mouse to start every entry is the slow way round. */}
          {onNew && (
            <UnstyledButton
              onClick={onNew}
              className="cb-new-entry"
              aria-label={t("register.newEntry")}
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                gap: ROW_GAP,
                padding: `${BAND_PADDING.newEntry}px ${BAND_INSET}px`,
                background: "var(--cb-band-new)",
                borderBottom: "1px solid var(--cb-ledger-border)",
                textAlign: "left",
              }}
            >
              <span />
              {/* The date is in the accent, because this line is an invitation
                  rather than a record: it is the only date on the page that has
                  not happened yet. */}
              <Text ff="monospace" c="var(--cb-accent-text)" fz={ROW_TYPE.date.fz} fw={500}>
                {fmtDate(todayCivil())}
              </Text>
              <Text fz={ROW_TYPE.newEntry.fz} c="dimmed" truncate style={{ gridColumn: "span 2" }}>
                {t("register.newEntry")}
              </Text>
              <span />
              <span />
              <Group justify="flex-end">
                <Kbd size="xs">N</Kbd>
              </Group>
            </UnstyledButton>
          )}
          <div
            ref={parentRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            style={{ height: bodyHeight ?? "min(560px, 65vh)", overflow: "auto", outline: "none" }}
            aria-label={t("register.ledger")}
          >
            <div
              style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const row = tableRows[vi.index];
                const r = row.original;
                const onCursor = r.id === cursorId;
                const divider = vi.index === dividerIndex;
                return (
                  <Fragment key={row.id}>
                    {divider && (
                      <Group
                        gap={ROW_GAP}
                        wrap="nowrap"
                        align="center"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vi.start}px)`,
                          height: DIVIDER_HEIGHT,
                          padding: `${BAND_PADDING.divider}px ${BAND_INSET}px`,
                          background: "var(--cb-band-divider)",
                        }}
                      >
                        <Text
                          ff="monospace"
                          fz={ROW_TYPE.divider.fz}
                          fw={ROW_TYPE.divider.fw}
                          c="dimmed"
                        >
                          {fmtDate(r.date)}
                        </Text>
                        <Box
                          style={{ flex: 1, height: 1, background: "var(--cb-ledger-border)" }}
                        />
                        <Text fz={ROW_TYPE.divider.fz} fw={ROW_TYPE.divider.fw} c="dimmed">
                          {t("register.reconciledUpToHere")}
                        </Text>
                      </Group>
                    )}
                    <div
                      className={r.id === arrivedId ? "cb-row-arrived" : undefined}
                      onClick={() => setCursorId(r.id)}
                      onDoubleClick={() => onEdit(r)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCursorId(r.id);
                        setMenu({ x: e.clientX, y: e.clientY, row: r });
                      }}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        userSelect: "none",
                        transform: `translateY(${vi.start + (divider ? DIVIDER_HEIGHT : 0)}px)`,
                        height: baseRowHeight(vi.index),
                        display: "grid",
                        gridTemplateColumns: gridTemplate,
                        gap: ROW_GAP,
                        alignItems: "center",
                        padding: `0 ${BAND_INSET}px`,
                        // A left accent marks future (scheduled) rows; transparent on
                        // past/today rows keeps the content aligned.
                        borderLeft:
                          r.date > todayStr
                            ? "3px solid var(--mantine-color-blue-5)"
                            : "3px solid transparent",
                        background: selected.has(r.id)
                          ? "var(--mantine-color-blue-light)"
                          : onCursor
                            ? "var(--mantine-color-default-hover)"
                            : undefined,
                        borderBottom: "1px solid var(--cb-ledger-border)",
                      }}
                    >
                      <Checkbox
                        size="xs"
                        aria-label={t("register.selectRow")}
                        checked={selected.has(r.id)}
                        onChange={() => onToggleSelect(r.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Shift+click selects the contiguous range from the anchor
                          // row to this one (preventDefault stops the plain toggle).
                          if (e.shiftKey && selectAnchorRef.current != null) {
                            e.preventDefault();
                            const from = Math.min(selectAnchorRef.current, vi.index);
                            const to = Math.max(selectAnchorRef.current, vi.index);
                            onToggleAll(
                              tableRows.slice(from, to + 1).map((rr) => rr.original.id),
                              true,
                            );
                          } else {
                            selectAnchorRef.current = vi.index;
                          }
                        }}
                      />
                      {row.getVisibleCells().map((cell) => (
                        <Box
                          key={cell.id}
                          style={{ minWidth: 0 }}
                          data-cb-sensitive={SENSITIVE_COLUMNS.has(cell.column.id) || undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </Box>
                      ))}
                      <Group gap={2} justify="flex-end" wrap="nowrap" {...stopRowEdit}>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="gray"
                          aria-label={t("templates.saveAs")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSaveTemplate(r);
                          }}
                        >
                          <IconDeviceFloppy size={15} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          aria-label={t("transactions.edit")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(r);
                          }}
                        >
                          <IconPencil size={15} />
                        </ActionIcon>
                        <ActionIcon
                          variant="subtle"
                          size="sm"
                          color="red"
                          aria-label={t("transactions.delete")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(r);
                          }}
                        >
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Group>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
          {/* The foot of the card. It stays put while the ledger scrolls, so
              what you have picked and what it comes to never scroll away. */}
          <div ref={footRef}>{bulkBar}</div>
        </Box>

        {/* Right-click context menu, anchored at the cursor. */}
        <Menu
          opened={menu != null}
          onClose={() => setMenu(null)}
          position="bottom-start"
          withinPortal
          shadow="md"
          width={210}
        >
          <Menu.Target>
            <div
              aria-hidden
              style={{
                position: "fixed",
                left: menu?.x ?? 0,
                top: menu?.y ?? 0,
                width: 0,
                height: 0,
              }}
            />
          </Menu.Target>
          <Menu.Dropdown>
            {menu &&
              (() => {
                const r = menu.row;
                const run = (fn: () => void) => () => {
                  setMenu(null);
                  fn();
                };
                return (
                  <>
                    {selected.size > 1 && (onBulkEdit || onBulkDelete) && (
                      <>
                        <Menu.Label>{t("bulk.title", { count: selected.size })}</Menu.Label>
                        {onBulkEdit && (
                          <Menu.Item
                            leftSection={<IconPencil size={15} />}
                            onClick={run(onBulkEdit)}
                          >
                            {t("bulk.edit")}
                          </Menu.Item>
                        )}
                        {onBulkDelete && (
                          <Menu.Item
                            color="red"
                            leftSection={<IconTrash size={15} />}
                            onClick={run(onBulkDelete)}
                          >
                            {t("bulk.delete")}
                          </Menu.Item>
                        )}
                        <Menu.Divider />
                      </>
                    )}
                    {r.payeeName ? <Menu.Label>{r.payeeName}</Menu.Label> : null}
                    <Menu.Item
                      leftSection={<IconPencil size={15} />}
                      onClick={run(() => onEdit(r))}
                    >
                      {t("transactions.edit")}
                    </Menu.Item>
                    {r.transferId == null && (
                      <Menu.Item
                        leftSection={<IconCopy size={15} />}
                        onClick={run(() => onDuplicate(r))}
                      >
                        {t("transactions.duplicate")}
                      </Menu.Item>
                    )}
                    <Menu.Item
                      leftSection={<IconCircleCheck size={15} />}
                      onClick={run(() => onToggleStatus(r, r.status === 1 ? 0 : 1))}
                    >
                      {t("register.markCleared")}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconLock size={15} />}
                      onClick={run(() =>
                        onToggleStatus(r, r.status === STATUS_RECONCILED ? 0 : STATUS_RECONCILED),
                      )}
                    >
                      {t("register.markReconciled")}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconDeviceFloppy size={15} />}
                      onClick={run(() => onSaveTemplate(r))}
                    >
                      {t("templates.saveAs")}
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={15} />}
                      onClick={run(() => onDelete(r))}
                    >
                      {t("transactions.delete")}
                    </Menu.Item>
                  </>
                );
              })()}
          </Menu.Dropdown>
        </Menu>
      </Box>
      {panel === "filters" && (
        <RegisterSidePanel title={t("filters.section")} onClose={() => onPanel(null)}>
          {filtersPanel}
        </RegisterSidePanel>
      )}
      {panel === "columns" && (
        <RegisterSidePanel
          title={t("register.columns")}
          hint={t("register.columnsHint")}
          onClose={() => onPanel(null)}
        >
          {columnsPanel}
        </RegisterSidePanel>
      )}
    </Group>
  );
}

/**
 * A column heading: click to sort, drag its right edge to widen the column.
 *
 * The grip is a plain pointer drag rather than a library: the table is a CSS
 * grid, so a width is one number in the template, and the drag only has to
 * report it.
 */
function ColumnHeader({
  id,
  sort,
  onSort,
  onResize,
  onResizeEnd,
  children,
}: {
  id: string;
  sort: RegisterSort | null;
  onSort: (id: string) => void;
  onResize: (width: number) => void;
  onResizeEnd: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const sortable = isSortable(id);
  const active = sort?.id === id;

  const startResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = ref.current?.getBoundingClientRect().width ?? 120;
    const move = (ev: PointerEvent) =>
      onResize(Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <Box ref={ref} style={{ position: "relative", minWidth: 0 }}>
      {sortable ? (
        <UnstyledButton
          onClick={() => onSort(id)}
          aria-label={t("register.sortBy")}
          style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", minWidth: 0 }}
        >
          <Box style={{ minWidth: 0, overflow: "hidden" }}>{children}</Box>
          {active &&
            (sort.desc ? (
              <IconArrowDown size={13} stroke={2.5} />
            ) : (
              <IconArrowUp size={13} stroke={2.5} />
            ))}
        </UnstyledButton>
      ) : (
        children
      )}
      <span
        role="separator"
        aria-label={t("register.resizeColumn")}
        onPointerDown={startResize}
        className="cb-col-grip"
      />
    </Box>
  );
}

/**
 * A text cell that can carry the row.
 *
 * Whichever text column comes first is the row's subject and is set at full
 * size; what would otherwise be demoted to small grey type — the memo behind a
 * payee, or the fact that a transaction still needs a category — sits under it
 * as a second line. Turn Payee off and Memo leads, at full size, which is the
 * rule the tile states and the reason this is a component rather than a `Text`.
 */
function LeadCell({ lead, sub, icon }: { lead?: string; sub?: Sub; icon?: ReactNode }) {
  return (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
        {icon}
        <Text fz={ROW_TYPE.lead.fz} fw={ROW_TYPE.lead.fw} truncate>
          {lead}
        </Text>
      </Group>
      {sub && (
        <Text fz={ROW_TYPE.subLine.fz} c={sub.attention ? attentionColor : "dimmed"} truncate>
          {sub.text}
        </Text>
      )}
    </Stack>
  );
}

interface Sub {
  text: string;
  attention?: boolean;
}

/**
 * What goes under the lead line, if anything.
 *
 * The memo when the payee leads, and — when there is nothing else to say and
 * the transaction is missing its category — the fact that it needs one. Saying
 * it here rather than leaving the category cell blank is what turns an empty
 * cell into something the reader can act on.
 */
function leadSub(
  column: "payee" | "note",
  row: RegisterRow,
  t: (k: string) => string,
): Sub | undefined {
  if (column === "payee" && row.memo) return { text: row.memo };
  if (row.transferId == null && !row.isSplit && !row.categoryName)
    return { text: t("register.needsCategory"), attention: true };
  return undefined;
}

/**
 * A category, with the dot that makes a column of them scannable.
 *
 * An uncategorised row gets a hollow dot and the attention colour: it is the
 * one state in this column worth noticing, and a blank cell does not say it.
 */
function CategoryCell({ name, uncategorised }: { name: string; uncategorised: boolean }) {
  return (
    <Group gap={7} wrap="nowrap" style={{ minWidth: 0 }}>
      <Box
        style={{
          width: CATEGORY_DOT,
          height: CATEGORY_DOT,
          borderRadius: 999,
          flexShrink: 0,
          background: uncategorised ? "transparent" : "var(--mantine-color-dimmed)",
          border: uncategorised ? `1px dashed ${attentionColor}` : undefined,
        }}
      />
      <Text fz={ROW_TYPE.category.fz} c={uncategorised ? attentionColor : "dimmed"} truncate>
        {name}
      </Text>
    </Group>
  );
}

/**
 * The smallest a grid track can be drawn at.
 *
 * Fixed tracks are their own width; a `minmax(Npx, 1fr)` track is N, which is
 * the point of writing it that way — the column gives up its extra when the
 * window is narrow and takes the slack when it is not.
 */
function trackFloor(track: string): number {
  const minmax = /^minmax\(\s*(\d+)px/.exec(track);
  if (minmax) return Number(minmax[1]);
  const px = /^(\d+)px$/.exec(track);
  return px ? Number(px[1]) : 100;
}
