import { ActionIcon, Badge, Box, Checkbox, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconAdjustmentsHorizontal,
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
import { formatMinor, type MoneyFormat } from "../money";
import { stopRowEdit } from "../rowEdit";
import { moveColumn, normalizeColumnOrder } from "./registerColumns";
import { isSortable, sortRegisterRows, type RegisterSort } from "./registerFilterModel";
import { useToday } from "../useToday";
import { amountColor, negativeOnlyColor } from "../amountTone";

const ROW_HEIGHT = 40;
// Per-column grid widths (fixed so virtualized rows stay aligned). Status is
// wide enough for the longest label ("Non riconciliato") plus the lock glyph.
const COL_WIDTH: Record<string, string> = {
  date: "104px",
  payee: "minmax(110px, 1fr)",
  category: "minmax(104px, 1fr)",
  note: "minmax(130px, 1.2fr)",
  status: "140px",
  amount: "116px",
  runningBalance: "124px",
};
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
  useLayoutEffect(() => {
    if (!fillRef) return;
    const scroll = parentRef.current;
    if (!scroll) return;
    // Footer (36) + Main bottom padding (md=16) + a little breathing room.
    const BOTTOM_GAP = 56;
    const measure = () => {
      const top = scroll.getBoundingClientRect().top;
      setBodyHeight(Math.max(240, Math.round(window.innerHeight - top - BOTTOM_GAP)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (fillRef.current) ro.observe(fillRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fillRef]);

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
          if (date <= todayStr) return fmtDate(date);
          // Future-dated (scheduled) rows: a clock glyph and italic, dimmed date.
          return (
            <Group gap={4} wrap="nowrap" c="dimmed">
              <IconClock size={13} title={t("register.future")} />
              <Text size="sm" fs="italic">
                {fmtDate(date)}
              </Text>
            </Group>
          );
        },
      }),
      col.display({
        id: "payee",
        header: () => t("transactions.payee"),
        cell: ({ row }) =>
          row.original.transferId != null ? (
            <Group gap={4} wrap="nowrap">
              <IconArrowsExchange size={14} />
              <Text size="sm" truncate>
                {accountName(row.original.transferAccountId) ?? t("transfers.transfer")}
              </Text>
            </Group>
          ) : (
            <Text size="sm" truncate>
              {row.original.payeeName}
            </Text>
          ),
      }),
      col.display({
        id: "category",
        header: () => t("transactions.category"),
        cell: ({ row }) => (
          <Text size="sm" truncate>
            {row.original.transferId != null
              ? t("transfers.transfer")
              : row.original.isSplit
                ? t("transactions.split")
                : row.original.categoryName}
          </Text>
        ),
      }),
      col.accessor("memo", {
        id: "note",
        header: () => t("transactions.memo"),
        cell: ({ getValue }) => (
          <Text size="sm" truncate>
            {getValue()}
          </Text>
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
  const gridTemplate = [
    "36px",
    ...table
      .getVisibleLeafColumns()
      .map((c) => (widths[c.id] ? `${widths[c.id]}px` : (COL_WIDTH[c.id] ?? "minmax(100px, 1fr)"))),
    "92px",
  ].join(" ");

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
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

  return (
    // Scroll the ledger horizontally within its container on narrow screens so
    // the page itself never overflows; the header and rows scroll together.
    <Box style={{ overflowX: "auto" }}>
      <Box style={{ minWidth: 900 }}>
        <Box
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate,
            gap: 8,
            padding: "6px 8px",
            // Matches the 3px accent reserved on each row so columns stay aligned.
            borderLeft: "3px solid transparent",
            fontWeight: 600,
            fontSize: 13,
            borderBottom: "1px solid var(--mantine-color-default-border)",
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
          <Group justify="flex-end">
            <Menu position="bottom-end" withinPortal closeOnItemClick={false}>
              <Menu.Target>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="gray"
                  aria-label={t("register.columns")}
                >
                  <IconAdjustmentsHorizontal size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("register.columns")}</Menu.Label>
                {columnOrder.map((id, i) => {
                  const toggleable = TOGGLEABLE.find((c) => c.id === id);
                  return (
                    <Menu.Item
                      key={id}
                      component="div"
                      style={{ cursor: toggleable ? "pointer" : "default" }}
                      onClick={() => toggleable && table.getColumn(id)?.toggleVisibility()}
                    >
                      <Group gap="xs" wrap="nowrap" justify="space-between">
                        <Checkbox
                          size="xs"
                          readOnly
                          // Date and amount cannot be hidden — a ledger without
                          // them is not a ledger — but they can still be moved.
                          disabled={!toggleable}
                          checked={toggleable ? (columnVisibility[id] ?? toggleable.def) : true}
                          label={t(COL_LABEL[id])}
                        />
                        <Group gap={2} wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                          <ActionIcon
                            variant="subtle"
                            size="sm"
                            color="gray"
                            disabled={i === 0}
                            aria-label={t("register.moveColumnLeft")}
                            onClick={() =>
                              persistPrefs.mutate({
                                registerColumnOrder: moveColumn(columnOrder, id, -1),
                              })
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
                              persistPrefs.mutate({
                                registerColumnOrder: moveColumn(columnOrder, id, 1),
                              })
                            }
                          >
                            <IconChevronDown size={14} />
                          </ActionIcon>
                        </Group>
                      </Group>
                    </Menu.Item>
                  );
                })}
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Box>
        <div
          ref={parentRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          style={{ height: bodyHeight ?? "min(560px, 65vh)", overflow: "auto", outline: "none" }}
          aria-label={t("register.ledger")}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const row = tableRows[vi.index];
              const r = row.original;
              const onCursor = r.id === cursorId;
              return (
                <div
                  key={row.id}
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
                    transform: `translateY(${vi.start}px)`,
                    height: ROW_HEIGHT,
                    display: "grid",
                    gridTemplateColumns: gridTemplate,
                    gap: 8,
                    alignItems: "center",
                    padding: "0 8px",
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
                    borderBottom: "1px solid var(--mantine-color-default-border)",
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
              );
            })}
          </div>
        </div>
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
                        <Menu.Item leftSection={<IconPencil size={15} />} onClick={run(onBulkEdit)}>
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
                  <Menu.Item leftSection={<IconPencil size={15} />} onClick={run(() => onEdit(r))}>
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
