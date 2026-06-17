import { ActionIcon, Badge, Box, Group, Text } from "@mantine/core";
import { IconArrowsExchange, IconPencil, IconTrash } from "@tabler/icons-react";
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
import { formatMinor, type MoneyFormat } from "../money";

const ROW_HEIGHT = 40;
const GRID = "110px minmax(120px, 1fr) minmax(120px, 1fr) 96px 130px 140px 64px";
// Status badge colours indexed by status value (none..void).
const STATUS_COLORS = ["gray", "blue", "teal", "orange", "red"];

export interface RegisterTableProps {
  rows: RegisterRow[];
  accounts: Account[];
  fmt: MoneyFormat;
  onEdit: (row: RegisterRow) => void;
  onDelete: (row: RegisterRow) => void;
  onToggleStatus: (row: RegisterRow, status: number) => void;
}

// RegisterTable renders the account ledger newest-first with a chronological
// running balance, virtualized so very large accounts scroll smoothly.
// Keyboard: ↑/↓ move the selection, Enter edits, c/r toggle cleared/reconciled,
// Delete removes.
export function RegisterTable({
  rows,
  accounts,
  fmt,
  onEdit,
  onDelete,
  onToggleStatus,
}: RegisterTableProps) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Newest-first display; each row keeps its chronological running balance.
  const display = useMemo(() => [...rows].reverse(), [rows]);
  const accountName = useCallback(
    (id?: number | null) => accounts.find((a) => a.id === id)?.name,
    [accounts],
  );

  const columns = useMemo(() => {
    const col = createColumnHelper<RegisterRow>();
    return [
      col.accessor("date", { header: () => t("transactions.date") }),
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
  }, [t, fmt, accountName, onToggleStatus]);

  const table = useReactTable({
    data: display,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const tableRows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const selectedIndex = useMemo(
    () => display.findIndex((r) => r.id === selectedId),
    [display, selectedId],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (display.length === 0) return;
    const move = (delta: number) => {
      const next = Math.min(
        Math.max(selectedIndex < 0 ? 0 : selectedIndex + delta, 0),
        display.length - 1,
      );
      setSelectedId(display[next].id);
      virtualizer.scrollToIndex(next, { align: "auto" });
    };
    const sel = selectedIndex >= 0 ? display[selectedIndex] : null;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
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
        if (sel) onToggleStatus(sel, sel.status === 2 ? 0 : 2);
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
    if (selectedId != null && !display.some((r) => r.id === selectedId)) setSelectedId(null);
  }, [display, selectedId]);

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
            const selected = row.original.id === selectedId;
            return (
              <div
                key={row.id}
                onClick={() => setSelectedId(row.original.id)}
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
                  cursor: "default",
                  background: selected ? "var(--mantine-color-default-hover)" : undefined,
                  borderBottom: "1px solid var(--mantine-color-default-border)",
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <Box key={cell.id} style={{ minWidth: 0 }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Box>
                ))}
                <Group gap={2} justify="flex-end" wrap="nowrap">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label={t("transactions.edit")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(row.original);
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
                      onDelete(row.original);
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
