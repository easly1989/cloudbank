import { ActionIcon, Badge, Box, Checkbox, Group, Text } from "@mantine/core";
import {
  IconArrowsExchange,
  IconDeviceFloppy,
  IconLock,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Account, RegisterRow } from "../api/client";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";

const ROW_HEIGHT = 40;
const GRID = "36px 104px minmax(110px, 1fr) minmax(104px, 1fr) 94px 116px 124px 92px";
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
  onDelete: (row: RegisterRow) => void;
  onToggleStatus: (row: RegisterRow, status: number) => void;
  onSaveTemplate: (row: RegisterRow) => void;
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
  onDelete,
  onToggleStatus,
  onSaveTemplate,
}: RegisterTableProps) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const parentRef = useRef<HTMLDivElement>(null);
  const [cursorId, setCursorId] = useState<number | null>(null);

  // Newest-first display; each row keeps its chronological running balance.
  const display = useMemo(() => [...rows].reverse(), [rows]);
  const accountName = useCallback(
    (id?: number | null) => accounts.find((a) => a.id === id)?.name,
    [accounts],
  );
  const allSelected = display.length > 0 && display.every((r) => selected.has(r.id));

  const columns = useMemo(() => {
    const col = createColumnHelper<RegisterRow>();
    return [
      col.accessor("date", {
        header: () => t("transactions.date"),
        cell: ({ getValue }) => fmtDate(getValue()),
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
      col.accessor("status", {
        header: () => t("transactions.status"),
        cell: ({ row }) => (
          <Group gap={4} wrap="nowrap">
            <Badge
              variant="light"
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
          </Group>
        ),
      }),
      col.accessor("amount", {
        header: () => <Box ta="right">{t("transactions.amount")}</Box>,
        cell: ({ row }) => (
          <Text size="sm" ta="right" c={row.original.amount < 0 ? "red" : "teal"}>
            {formatMinor(row.original.amount, fmt)}
          </Text>
        ),
      }),
      col.accessor("runningBalance", {
        header: () => <Box ta="right">{t("register.balance")}</Box>,
        cell: ({ row }) => (
          <Text
            size="sm"
            ta="right"
            fw={500}
            c={row.original.runningBalance < 0 ? "red" : undefined}
          >
            {formatMinor(row.original.runningBalance, fmt)}
          </Text>
        ),
      }),
    ];
  }, [t, fmt, fmtDate, accountName, onToggleStatus]);

  const table = useReactTable({ data: display, columns, getCoreRowModel: getCoreRowModel() });
  const tableRows = table.getRowModel().rows;

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
    <Box>
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          gap: 8,
          padding: "6px 8px",
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
        {table.getFlatHeaders().map((h) => (
          <Box key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</Box>
        ))}
        <Box />
      </Box>
      <div
        ref={parentRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ height: 560, overflow: "auto", outline: "none" }}
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
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vi.start}px)`,
                  height: ROW_HEIGHT,
                  display: "grid",
                  gridTemplateColumns: GRID,
                  gap: 8,
                  alignItems: "center",
                  padding: "0 8px",
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
                  onClick={(e) => e.stopPropagation()}
                />
                {row.getVisibleCells().map((cell) => (
                  <Box key={cell.id} style={{ minWidth: 0 }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Box>
                ))}
                <Group gap={2} justify="flex-end" wrap="nowrap">
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
  );
}
