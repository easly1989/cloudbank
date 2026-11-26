import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Checkbox,
  Group,
  Kbd,
  Menu,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconChevronUp,
  IconArrowsExchange,
  IconArrowsHorizontal,
  IconCircleCheck,
  IconClock,
  IconCopy,
  IconDeviceFloppy,
  IconLock,
  IconMail,
  IconPaperclip,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { useMediaQuery } from "@mantine/hooks";
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

import { type Preferences, savePreferences, type Account, type RegisterRow } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useDateFormat } from "../dates";
import { todayCivil } from "../civilDate";
import { formatMinor, type MoneyFormat } from "../money";
import { notifyError } from "../notifyError";
import { stopRowEdit } from "../rowEdit";
import {
  ALL_COLUMNS,
  columnTracks,
  GROW_COLUMNS,
  moveColumn,
  normalizeColumnOrder,
  pinnedColumns,
  pinShift,
} from "./registerColumns";
import {
  BAND_INSET,
  BAND_PADDING,
  CATEGORY_DOT,
  ROW_ACTION,
  ROW_ACTIONS_WIDTH,
  ROW_COLUMNS,
  DIVIDER_HEIGHT,
  ROW_GAP,
  ROW_SELECT_WIDTH,
  ROW_TYPE,
} from "./registerTheme";
import { RegisterSidePanel } from "./RegisterSidePanel";
import type { PanelId, RegisterPanels } from "./registerPanels";
import {
  isSortable,
  reconciledMarks,
  sortRegisterRows,
  type ReconciledMark,
  type RegisterSort,
} from "./registerFilterModel";
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
//
// Status starts hidden, as on the register board. It is the app's own column —
// 140px, which the Italian labels and the lock and paperclip beside them need —
// and with it the default row came to 1014px against the 981 the register gets
// at the board's own 1280, so the ledger scrolled sideways and a row's own
// actions fell off the right. It is one tick away in the column panel, and a
// row's status still changes from its menu and with C / R. A saved choice wins
// over this default, so nobody who has already set their columns loses it.
const TOGGLEABLE: { id: string; def: boolean }[] = [
  { id: "payee", def: true },
  { id: "category", def: true },
  { id: "note", def: false },
  { id: "status", def: false },
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
  /** Which side panels are open: on a desktop both can be, one above the other. */
  panels: RegisterPanels;
  onTogglePanel: (id: PanelId) => void;
  /** Shown instead of the ledger when the filters leave no row (#535): an empty
      grid with a header says nothing the message does not. Desktop only. */
  empty?: ReactNode;
  /** The filter controls, rendered inside the panel when it is showing them. */
  filtersPanel: ReactNode;
  /** Start a new transaction. Absent while reconciling, where entry is off. */
  onNew?: () => void;
  /** The selection bar, shown at the foot of the card whenever rows are picked. */
  bulkBar?: ReactNode;
  /** The band that explains what the filter is hiding, at the head of the card. */
  notice?: ReactNode;
  /** Every row of the account, oldest first: where the hidden rows sit (#480). */
  ledgerRows?: RegisterRow[];
  /**
   * The reconciled rows the status filter is hiding; each run of them is marked
   * with a line where it would sit (see hiddenReconciled, reconciledMarks).
   */
  hiddenReconciled?: RegisterRow[];
  /** A row that has just been saved, marked until the tint fades. */
  arrivedId?: number | null;
  /**
   * A row the reader came here for from another page (a registered bill on the
   * schedules calendar, #546): the cursor lands on it, the ledger brings it to
   * the middle, and it stays marked until the cursor moves.
   */
  landOnId?: number | null;
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
  panels,
  onTogglePanel,
  empty,
  filtersPanel,
  onNew,
  bulkBar,
  notice,
  arrivedId,
  landOnId,
  ledgerRows,
  hiddenReconciled,
}: RegisterTableProps) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
  const parentRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
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
  const [emptyHeight, setEmptyHeight] = useState<number>();
  const footRef = useRef<HTMLDivElement>(null);
  const isEmpty = empty != null;
  useLayoutEffect(() => {
    if (!fillRef) return;
    const scroll = parentRef.current;
    const blank = emptyRef.current;
    if (!scroll && !blank) return;
    const measure = () => {
      // Main's bottom padding already holds the footer's height, or none when
      // the footer is hidden; then a little breathing room. A fixed 36px for the
      // footer left that much empty under the ledger with the footer off.
      const main = (scroll ?? blank)!.closest(".mantine-AppShell-main");
      const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 52;
      const BOTTOM_GAP = pad + 4;
      // The message that stands in for the ledger ends where the ledger's card
      // would: its body's bottom, plus the card's border.
      if (!scroll) {
        const top = blank!.getBoundingClientRect().top;
        setEmptyHeight(Math.max(240, Math.round(window.innerHeight - top - BOTTOM_GAP + 1)));
        return;
      }
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
  }, [fillRef, bulkBar, isEmpty]);

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
  // The text column that takes the free width, if the user picked one. It hands
  // the width back to Payee when it is hidden or dragged, and the panel says so
  // once, since the change was a side effect of something else.
  const growChoice = user?.preferences?.registerGrowColumn;
  const [growNotice, setGrowNotice] = useState<{ key: string; id: string } | null>(null);

  // The notice belongs to the open Columns panel: closing (or opening) it clears it.
  useEffect(() => setGrowNotice(null), [panels.columns]);

  // Settling here, not in a per-call onSettled: react-query runs that one only
  // for the latest mutate, so a visibility toggle or a Move during a drag save
  // would have left the dragged widths on screen for good.
  const persistPrefs = useMutation({
    mutationFn: (patch: Partial<Preferences>) => savePreferences(qc, patch),
    onSettled: () => setDragWidths(null),
  });

  // When the chosen column loses the free width, the notice names what really
  // takes it: Payee, or nobody if Payee is hidden or dragged too.
  const visibleIds = columnOrder.filter((id) => columnVisibility[id] !== false);
  const growFallback = (visible: string[], w: Record<string, number>) =>
    columnTracks(visible, undefined, w, COL_WIDTH).grow;

  // The drag reports the width it ended on: the handler it calls was made
  // when the drag began, so reading dragWidths there would see the empty
  // state of that moment, save nothing and put the column back. The dragged
  // width stays on screen until the save settles, so no frame falls between
  // it and the preferences that carry it.
  const endResize = (id: string, width: number | null) => {
    if (width == null) {
      setDragWidths(null);
      return;
    }
    const next = { ...(savedWidths ?? {}), [id]: width };
    setDragWidths(next);
    const dropGrow = id === growChoice;
    if (dropGrow)
      setGrowNotice({
        key: growFallback(visibleIds, next) ? "register.growDragged" : "register.growDraggedNone",
        id,
      });
    persistPrefs.mutate(
      { registerColumnWidths: next, ...(dropGrow ? { registerGrowColumn: undefined } : {}) },
      { onError: notifyError },
    );
  };

  const toggleSort = (id: string) => {
    if (!isSortable(id)) return;
    // Click cycles ascending, descending, then back to the ledger's own order.
    const next = sort?.id !== id ? { id, desc: false } : sort.desc ? null : { id, desc: true };
    persistPrefs.mutate({ registerSort: next ?? undefined });
  };

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

  // The note has its own column when shown, so the payee stops repeating it.
  const noteShown = !!columnVisibility.note;
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
            icon={
              row.original.transferId != null ? (
                <IconArrowsExchange size={14} />
              ) : row.original.fromMail ? (
                <Tooltip label={t("register.fromMail")} withArrow>
                  <IconMail
                    size={14}
                    style={{ flexShrink: 0, opacity: 0.6 }}
                    aria-label={t("register.fromMail")}
                    data-testid="from-mail"
                  />
                </Tooltip>
              ) : undefined
            }
            sub={leadSub("payee", row.original, t, noteShown)}
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
                    : (row.original.categoryName ?? t("filters.uncategorised"))
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
  }, [t, fmt, fmtDate, accountName, onToggleStatus, todayStr, noteShown]);

  const table = useReactTable({
    data: display,
    columns,
    state: { columnVisibility, columnOrder },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      const dropGrow = growChoice != null && next[growChoice] === false;
      if (dropGrow)
        setGrowNotice({
          key: growFallback(
            visibleIds.filter((id) => id !== growChoice),
            widths,
          )
            ? "register.growHidden"
            : "register.growHiddenNone",
          id: growChoice,
        });
      else if (growNotice?.key.startsWith("register.growHidden") && next[growNotice.id])
        setGrowNotice({ key: "register.growShownAgain", id: growNotice.id });
      persistPrefs.mutate({
        registerColumns: next as Record<string, boolean>,
        ...(dropGrow ? { registerGrowColumn: undefined } : {}),
      });
    },
    getCoreRowModel: getCoreRowModel(),
  });
  const tableRows = table.getRowModel().rows;

  // Build the grid template from the currently visible columns (checkbox +
  // visible data columns + actions), so hidden columns reclaim their space.
  const visibleCols = table.getVisibleLeafColumns().map((c) => c.id);
  const layout = columnTracks(visibleCols, growChoice, widths, COL_WIDTH);
  const tracks = [ROW_SELECT_WIDTH, ...layout.tracks, ROW_ACTIONS_WIDTH];
  // The cells that stay at the card's right edge when the row scrolls sideways
  // (app.css, .cb-pin), with the actions after them.
  const pinned = new Set(pinnedColumns(visibleCols));

  // Pick the column that takes the free width. Picking one drops the width it
  // was dragged to, or it would stay fixed; pressing the lit one again hands
  // the width back to Payee.
  const chooseGrow = (id: string) => {
    const pressed = layout.grow === id;
    if (pressed && id === "payee") return;
    setGrowNotice(null);
    // A drag whose save has not settled would keep the width this drops.
    setDragWidths(null);
    const patch: Partial<Preferences> = {
      registerGrowColumn: pressed || id === "payee" ? undefined : (id as "category" | "note"),
    };
    if (!pressed && savedWidths?.[id]) {
      const rest = { ...savedWidths };
      delete rest[id];
      patch.registerColumnWidths = rest;
    }
    persistPrefs.mutate(patch, { onError: notifyError });
  };
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

  // Whether the pinned cells stay at the card's right edge (app.css, .cb-pin):
  // only while the row is wider than the card, so a card that fits draws and
  // antialiases its text exactly as it did, and only on a card of 576px or
  // more, below which the pinned cells (374px) would leave nothing to scroll.
  const cardRef = useRef<HTMLDivElement>(null);
  const [pinning, setPinning] = useState(false);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const check = () => setPinning(card.clientWidth >= 576 && card.scrollWidth > card.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(card);
    return () => ro.disconnect();
  }, [minRowWidth, isEmpty]);

  // Without scroll timelines (Firefox, Safari before 26) the card's scroll moves the
  // pinned cells from here instead. Chromium never attaches the listener.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || !pinning || CSS.supports?.("animation-timeline: scroll()")) return;
    const move = () => {
      const { x, shaded } = pinShift(card.scrollLeft, card.scrollWidth, card.clientWidth);
      card.style.setProperty("--cb-pin-x", `${x}px`);
      card.toggleAttribute("data-pin-shade", shaded);
    };
    move();
    card.addEventListener("scroll", move, { passive: true });
    const ro = new ResizeObserver(move);
    ro.observe(card);
    return () => {
      card.removeEventListener("scroll", move);
      ro.disconnect();
      card.style.removeProperty("--cb-pin-x");
      card.removeAttribute("data-pin-shade");
    };
  }, [pinning, minRowWidth]);

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

  // Lines standing for the reconciled rows the status filter hides, each where
  // its run would sit (#480). Only while the ledger runs newest first: sorted by
  // anything else, "where they would sit" and "reconciled up to here" mean
  // nothing. A line is drawn beside its row rather than as an item of its own,
  // which keeps every index in this table the index of a transaction.
  const marks = useMemo(() => {
    const newestFirst = !sort || (sort.id === "date" && sort.desc);
    if (!newestFirst || !ledgerRows || !hiddenReconciled?.length) return [];
    const ledger = sortRegisterRows([...ledgerRows].reverse(), sort);
    return reconciledMarks(
      ledger,
      tableRows.map((r) => r.original),
      hiddenReconciled,
    );
  }, [sort, ledgerRows, hiddenReconciled, tableRows]);
  const markAbove = useMemo(() => new Map(marks.map((m) => [m.before, m])), [marks]);
  const markAfter = markAbove.get(tableRows.length) ?? null;

  const rowHeight = useCallback(
    (index: number) =>
      baseRowHeight(index) +
      (markAbove.has(index) ? DIVIDER_HEIGHT : 0) +
      (markAfter && index === tableRows.length - 1 ? DIVIDER_HEIGHT : 0),
    [baseRowHeight, markAbove, markAfter, tableRows.length],
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
  // The virtualizer caches every estimate until the row count changes, so lines
  // that appear or move over the same rows would overlap them. Keyed on where
  // the lines are, not on rowHeight: that is rebuilt with the rows, and
  // measuring re-renders, so it would measure forever.
  const marksAt = marks.map((m) => m.before).join(",");
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, marksAt]);

  // One line: the run's date (or dates), and what it stands for. The band spans
  // the columns, but its text keeps to the visible width (100cqw of the ledger
  // card): on a phone the columns scroll sideways, and the count would sit
  // past the edge of the screen.
  const markLine = (m: ReconciledMark, top: number) => (
    <Box
      key={`mark-${m.before}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        transform: `translateY(${top}px)`,
        height: DIVIDER_HEIGHT,
        background: "var(--cb-band-divider)",
      }}
    >
      <Group
        gap={ROW_GAP}
        wrap="nowrap"
        align="center"
        style={{
          width: "min(100%, 100cqw)",
          height: "100%",
          padding: `${BAND_PADDING.divider}px ${BAND_INSET}px`,
        }}
      >
        <Text ff="monospace" fz={ROW_TYPE.divider.fz} fw={ROW_TYPE.divider.fw} c="dimmed">
          {m.from === m.to ? fmtDate(m.to) : `${fmtDate(m.from)} – ${fmtDate(m.to)}`}
        </Text>
        <Box style={{ flex: 1, height: 1, background: "var(--cb-ledger-border)" }} />
        <Text fz={ROW_TYPE.divider.fz} fw={ROW_TYPE.divider.fw} c="dimmed">
          {m.closesLedger
            ? t("register.reconciledAll")
            : t("register.reconciledRun", { count: m.count })}
        </Text>
      </Group>
    </Box>
  );

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

  // Once per arrival: the rows may load after the page, so this waits for the
  // row to be there, then does not pull the cursor back if the reader moves it.
  const landedFor = useRef<number | null>(null);
  useEffect(() => {
    if (landOnId == null || landedFor.current === landOnId) return;
    const i = display.findIndex((r) => r.id === landOnId);
    if (i < 0) return;
    landedFor.current = landOnId;
    setCursorId(landOnId);
    virtualizer.scrollToIndex(i, { align: "center" });
  }, [landOnId, display, virtualizer]);

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
            <Group gap={8} wrap="nowrap">
              {GROW_COLUMNS.includes(id) ? (
                // On, filled like the Columns button itself: a light tint on the
                // dark panel measured 1.2:1 and read as off. Off, a dimmed icon.
                <ActionIcon
                  variant={layout.grow === id ? "filled" : "subtle"}
                  size={24}
                  color={layout.grow === id ? undefined : "gray"}
                  c={layout.grow === id ? undefined : "dimmed"}
                  disabled={!columnVisibility[id]}
                  className="cb-grow-toggle"
                  style={!columnVisibility[id] ? { background: "none", opacity: 0.3 } : undefined}
                  aria-pressed={layout.grow === id}
                  aria-label={t(
                    columnVisibility[id] ? "register.growColumn" : "register.growNeedsShown",
                    { name: t(COL_LABEL[id]) },
                  )}
                  title={t(
                    columnVisibility[id] ? "register.growColumn" : "register.growNeedsShown",
                    { name: t(COL_LABEL[id]) },
                  )}
                  onClick={() => chooseGrow(id)}
                >
                  <IconArrowsHorizontal size={14} />
                </ActionIcon>
              ) : (
                <Box w={24} />
              )}
              <Group gap={2} wrap="nowrap">
                {/* Named for the column they move: seven buttons all called "Move
                  this column left" tell a screen reader nothing. 24px, not 22,
                  because they stack two pixels apart and 22 is under WCAG 2.5.8's
                  floor with no room around it. */}
                <ActionIcon
                  variant="subtle"
                  size={24}
                  color="gray"
                  disabled={i === 0}
                  aria-label={t("register.moveColumnLeft", { name: t(COL_LABEL[id]) })}
                  onClick={() =>
                    persistPrefs.mutate({ registerColumnOrder: moveColumn(columnOrder, id, -1) })
                  }
                >
                  <IconChevronUp size={14} />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  size={24}
                  color="gray"
                  disabled={i === columnOrder.length - 1}
                  aria-label={t("register.moveColumnRight", { name: t(COL_LABEL[id]) })}
                  onClick={() =>
                    persistPrefs.mutate({ registerColumnOrder: moveColumn(columnOrder, id, 1) })
                  }
                >
                  <IconChevronDown size={14} />
                </ActionIcon>
              </Group>
            </Group>
          </Group>
        );
      })}
      <Text fz="xs" c="dimmed" mt={6}>
        <IconArrowsHorizontal
          size={12}
          style={{ display: "inline", verticalAlign: -2, marginRight: 4 }}
        />
        {t("register.growHint")}
      </Text>
      {/* Always mounted, so a screen reader is watching it when the text lands. */}
      <Text fz="xs" c="dimmed" role="status">
        {growNotice &&
          t(growNotice.key, {
            name: t(COL_LABEL[growNotice.id]),
            payee: t(COL_LABEL.payee),
          })}
      </Text>
      <Group className="cb-panel-actions" justify="flex-end" mt="xs" gap="xs">
        <Button
          variant="default"
          onClick={() => {
            setGrowNotice(null);
            persistPrefs.mutate({
              registerColumnOrder: [...ALL_COLUMNS],
              registerColumns: Object.fromEntries(TOGGLEABLE.map((c) => [c.id, c.def])),
              registerGrowColumn: undefined,
            });
          }}
        >
          {t("register.columnsReset")}
        </Button>
        <Button onClick={() => onTogglePanel("columns")}>{t("actions.done")}</Button>
      </Group>
    </Stack>
  );

  const filtersNode = (
    <RegisterSidePanel
      title={t("filters.section")}
      onClose={() => onTogglePanel("filters")}
      grow
      footer={
        <Button fullWidth onClick={() => onTogglePanel("filters")}>
          {t("filters.showRows", { count: rows.length })}
        </Button>
      }
    >
      {filtersPanel}
    </RegisterSidePanel>
  );
  const columnsNode = (
    <RegisterSidePanel
      title={t("register.columns")}
      hint={t("register.columnsHint")}
      onClose={() => onTogglePanel("columns")}
    >
      {columnsPanel}
    </RegisterSidePanel>
  );

  return (
    // The ledger and whichever panel is open sit side by side. Both panels used
    // to unfold above the rows, and everything they took they took from the one
    // thing on the page worth looking at. On the side they cost width, which a
    // ledger has to spare, rather than height, which it does not.
    //
    // On a desktop the side column is as tall as the ledger beside it, and the
    // two panels share it (#535): the filters take what the columns leave.
    <Group align="stretch" wrap={phone ? "wrap" : "nowrap"} gap="md">
      {empty ? (
        <Center
          ref={emptyRef}
          className="cb-ledger-empty"
          style={{ flex: 1, minWidth: 0, height: emptyHeight ?? "min(560px, 65vh)" }}
        >
          {empty}
        </Center>
      ) : (
        <Box
          ref={cardRef}
          className={pinning ? "cb-pinning" : undefined}
          style={{
            overflowX: "auto",
            flex: 1,
            minWidth: 0,
            // How far the pinned cells travel, and how wide they are with their
            // gaps and the row's inset (app.css, .cb-pin).
            ["--cb-row-min" as string]: `${minRowWidth}px`,
            ["--cb-pin-width" as string]: `${
              tracks
                .slice(-1 - pinned.size)
                .reduce((sum, track) => sum + trackFloor(track) + ROW_GAP, 0) + BAND_INSET
            }px`,
            // The width a reconciled line's text keeps to (see markLine).
            containerType: "inline-size",
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
              // A heading Tab lands on under the pinned cells is on screen as
              // far as the browser can tell, so it would stay hidden: scroll it
              // clear of them (scroll-margin, app.css).
              onFocus={(e) => {
                if (pinning && e.target.matches(".cb-sort:focus-visible"))
                  e.target.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              style={{
                display: "grid",
                gridTemplateColumns: gridTemplate,
                gap: ROW_GAP,
                padding: `${BAND_PADDING.header}px ${BAND_INSET}px`,
                background: "var(--cb-band-header)",
                ["--cb-pin-bg" as string]: "var(--cb-band-header)",
                ["--cb-pin-pad" as string]: `${BAND_PADDING.header}px`,
                fontWeight: ROW_TYPE.header.fw,
                fontSize: ROW_TYPE.header.fz,
                borderBottom: "1px solid var(--cb-ledger-border)",
              }}
            >
              {/* A label round it, like each row's, so the whole cell takes the
                press and there is something to grow on a touch screen. */}
              <Box component="label" className="cb-row-select">
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
              </Box>
              {table.getHeaderGroups()[0].headers.map((h) => (
                <ColumnHeader
                  key={h.id}
                  id={h.id}
                  pinned={pinned.has(h.id)}
                  sort={sort}
                  onSort={toggleSort}
                  onResize={(width) => setDragWidths({ ...(savedWidths ?? {}), [h.id]: width })}
                  onResizeEnd={(width) => endResize(h.id, width)}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </ColumnHeader>
              ))}
              {/* The actions track has no heading, but pinned it still has to
                cover the headings that scroll under it. */}
              <span className="cb-pin" />
            </Box>
            {/* The way in is the first line of the ledger, where the next
              transaction will actually land — not a form above it. "N" is
              offered because a ledger is somewhere people type, and reaching
              for the mouse to start every entry is the slow way round. */}
            {onNew && (
              <UnstyledButton
                onClick={onNew}
                className="cb-new-entry"
                data-tour="register-new"
                aria-label={t("register.newEntry")}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridTemplate,
                  gap: ROW_GAP,
                  padding: `${BAND_PADDING.newEntry}px ${BAND_INSET}px`,
                  background: "var(--cb-band-new)",
                  ["--cb-pin-bg" as string]: "var(--cb-band-new)",
                  ["--cb-pin-pad" as string]: `${BAND_PADDING.newEntry}px`,
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
                <Text
                  fz={ROW_TYPE.newEntry.fz}
                  c="dimmed"
                  truncate
                  // Two columns, or one when only one is left before the
                  // pinned ones.
                  style={{
                    gridColumn: `span ${Math.max(1, Math.min(2, tracks.length - pinned.size - 3))}`,
                  }}
                >
                  {t("register.newEntry")}
                </Text>
                {/* The key sits in the actions track and stays pinned with it,
                  over an empty cell for the pinned columns before it. */}
                {pinned.size > 0 && (
                  <span className="cb-pin" style={{ gridColumn: `${-2 - pinned.size} / -2` }} />
                )}
                <Group className="cb-pin" justify="flex-end" style={{ gridColumn: "-2 / -1" }}>
                  <Kbd size="xs">N</Kbd>
                </Group>
              </UnstyledButton>
            )}
            {/* Focusable, so it has to show focus. It used to set outline: none and
              show nothing at all until the first arrow key — WCAG 2.4.7 — so a
              keyboard user tabbing in could not tell they had arrived. The ring
              is drawn inside the edge (app.css), where the scroll box cannot clip
              it. A region, so its name is one a screen reader will read out. */}
            <div
              ref={parentRef}
              tabIndex={0}
              role="region"
              className="cb-ledger"
              onKeyDown={onKeyDown}
              style={{ height: bodyHeight ?? "min(560px, 65vh)", overflow: "auto" }}
              aria-label={t("register.ledger")}
            >
              <div
                style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
              >
                {virtualizer.getVirtualItems().map((vi) => {
                  const row = tableRows[vi.index];
                  const r = row.original;
                  const onCursor = r.id === cursorId;
                  const landed = onCursor && r.id === landOnId;
                  const above = markAbove.get(vi.index);
                  const after = markAfter && vi.index === tableRows.length - 1 ? markAfter : null;
                  // A line above the row pushes it down; one after it sits below.
                  const rowTop = vi.start + (above ? DIVIDER_HEIGHT : 0);
                  const tint = selected.has(r.id)
                    ? "var(--mantine-color-blue-light)"
                    : landed
                      ? "var(--cb-arrival-tint)"
                      : onCursor
                        ? "var(--mantine-color-default-hover)"
                        : undefined;
                  return (
                    <Fragment key={row.id}>
                      {above && markLine(above, vi.start)}
                      {after && markLine(after, rowTop + baseRowHeight(vi.index))}
                      <div
                        className={
                          [r.id === arrivedId && "cb-row-arrived", landed && "cb-row-landed"]
                            .filter(Boolean)
                            .join(" ") || undefined
                        }
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
                          transform: `translateY(${rowTop}px)`,
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
                          background: tint,
                          // The pinned cells lay the same tint over the card.
                          ["--cb-row-tint" as string]: tint,
                          borderBottom: "1px solid var(--cb-ledger-border)",
                        }}
                      >
                        {/* The checkbox is 16px and sits in a row that moves the cursor
                          when clicked, so a finger that misses it by a hair did
                          something else — under WCAG 2.5.8's 24px floor, with no
                          room around it. The whole select column takes the press
                          instead, as a <label> for it — which is what that is. A
                          label would hand the checkbox a click of its own, without
                          the shift key; so that is cancelled and the same click is
                          handed over instead, shift key and all, and range
                          selection behaves exactly as it does on the box itself. */}
                        <Box
                          component="label"
                          className="cb-row-select"
                          onClick={(e) => {
                            if ((e.target as HTMLElement).tagName === "INPUT") return;
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.querySelector("input")?.dispatchEvent(
                              new MouseEvent("click", {
                                bubbles: true,
                                cancelable: true,
                                shiftKey: e.shiftKey,
                              }),
                            );
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
                        </Box>
                        {row.getVisibleCells().map((cell) => (
                          <Box
                            key={cell.id}
                            className={pinned.has(cell.column.id) ? "cb-pin" : undefined}
                            style={{ minWidth: 0 }}
                            data-cb-sensitive={SENSITIVE_COLUMNS.has(cell.column.id) || undefined}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </Box>
                        ))}
                        {/* Two actions at 30px, as the register board draws them. There
                          were three at 22 — under WCAG 2.5.8's 24px floor, side by
                          side — and three at 30 do not fit the column. Saving a row
                          as a template is the rarest of the three and was already
                          in the row's menu, so that is where it lives now. */}
                        <Group
                          className="cb-pin"
                          gap={ROW_ACTION.gap}
                          justify="flex-end"
                          wrap="nowrap"
                          {...stopRowEdit}
                        >
                          <ActionIcon
                            variant="subtle"
                            size={ROW_ACTION.size}
                            aria-label={t("transactions.edit")}
                            onClick={(e) => {
                              e.stopPropagation();
                              onEdit(r);
                            }}
                          >
                            <IconPencil size={ROW_ACTION.icon} />
                          </ActionIcon>
                          <ActionIcon
                            variant="subtle"
                            size={ROW_ACTION.size}
                            color="red"
                            aria-label={t("transactions.delete")}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(r);
                            }}
                          >
                            <IconTrash size={ROW_ACTION.icon} />
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
      )}
      {phone ? (
        <>
          {panels.filters && filtersNode}
          {panels.columns && columnsNode}
        </>
      ) : (
        (panels.filters || panels.columns) && (
          // Positioned so that its content, however long, never makes the row
          // taller than the ledger: the row's height is the ledger's.
          <Box w={300} pos="relative" style={{ flexShrink: 0 }}>
            <Stack gap="md" pos="absolute" style={{ inset: 0 }}>
              {panels.filters && filtersNode}
              {panels.columns && columnsNode}
            </Stack>
          </Box>
        )
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
  pinned,
  sort,
  onSort,
  onResize,
  onResizeEnd,
  children,
}: {
  id: string;
  pinned: boolean;
  sort: RegisterSort | null;
  onSort: (id: string) => void;
  onResize: (width: number) => void;
  /** The width the drag ended on, or null when the pointer never moved. */
  onResizeEnd: (width: number | null) => void;
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
    let last: number | null = null;
    const move = (ev: PointerEvent) => {
      last = Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX));
      onResize(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onResizeEnd(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <Box
      ref={ref}
      className={pinned ? "cb-pin" : undefined}
      style={{ position: "relative", minWidth: 0 }}
    >
      {sortable ? (
        <UnstyledButton
          className="cb-sort"
          onClick={() => onSort(id)}
          aria-label={t("register.sortBy")}
          style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", minWidth: 0 }}
        >
          {/* A heading longer than its column, a German compound most of all,
              hyphenates onto a second line (the page's lang picks the rules)
              rather than losing its end. */}
          <Box
            style={{
              minWidth: 0,
              overflow: "hidden",
              whiteSpace: "normal",
              hyphens: "auto",
              overflowWrap: "break-word",
            }}
          >
            {children}
          </Box>
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
        {(lead || !sub) && icon}
        <Text fz={ROW_TYPE.lead.fz} fw={ROW_TYPE.lead.fw} truncate>
          {lead}
        </Text>
      </Group>
      {sub && (
        // With nothing to lead, the mark goes before the line under it.
        <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
          {!lead && icon}
          <Text fz={ROW_TYPE.subLine.fz} c={sub.attention ? attentionColor : "dimmed"} truncate>
            {sub.text}
          </Text>
        </Group>
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
 * The memo when the payee leads (unless the Note column shows it), and — when there is nothing else to say and
 * the transaction is missing its category — the fact that it needs one. Saying
 * it here rather than leaving the category cell blank is what turns an empty
 * cell into something the reader can act on.
 */
function leadSub(
  column: "payee" | "note",
  row: RegisterRow,
  t: (k: string) => string,
  noteShown = false,
): Sub | undefined {
  if (column === "payee" && row.memo && !noteShown) return { text: row.memo };
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
