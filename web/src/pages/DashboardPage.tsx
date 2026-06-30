import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Menu,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustmentsHorizontal,
  IconEye,
  IconEyeOff,
  IconGripVertical,
  IconPencil,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  type CurrencyInfo,
  type DashboardAccount,
  type DashboardGroupBy,
  type MonthPoint,
  type Schedule,
  type User,
  getDashboard,
  listAccounts,
  listSchedules,
  listTemplates,
  postScheduleNow,
  skipSchedule,
  updateMe,
} from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Chart } from "../components/Chart";
import { Donut } from "../components/Donut";
import { useDateFormat } from "../dates";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { TransactionForm } from "./TransactionsPage";
import { type DatePreset, dateBounds, emptyFilters } from "./registerFilters";

const WIDGET_IDS = [
  "totals",
  "quickAdd",
  "incomeExpense",
  "accounts",
  "spending",
  "upcoming",
] as const;
type WidgetId = (typeof WIDGET_IDS)[number];
type WidgetSize = "full" | "half" | "third";

// resolveLayout returns the widget ids in the user's saved order, appending any
// not listed (e.g. widgets added in a later release) in their default order.
function resolveLayout(saved?: string[]): WidgetId[] {
  const valid = new Set<string>(WIDGET_IDS);
  const out: WidgetId[] = [];
  const seen = new Set<string>();
  for (const id of saved ?? [])
    if (valid.has(id) && !seen.has(id)) {
      out.push(id as WidgetId);
      seen.add(id);
    }
  for (const id of WIDGET_IDS) if (!seen.has(id)) out.push(id);
  return out;
}

// A fixed, color-blind-friendly palette cycled across spending slices.
const DONUT_PALETTE = [
  "#4dabf7",
  "#ff8787",
  "#69db7c",
  "#ffd43b",
  "#da77f2",
  "#3bc9db",
  "#ffa94d",
  "#a9e34b",
  "#9775fa",
];

type ChartType = "donut" | "bar";
type IEStyle = "bars" | "lines";

// DashView is the on-the-fly dashboard chart configuration the user can tweak;
// it is remembered in localStorage across reloads. period/chartType/groupBy
// drive the spending widget; ieMonths/ieStyle drive the income/expense chart.
interface DashView {
  period: DatePreset;
  chartType: ChartType;
  groupBy: DashboardGroupBy;
  ieMonths: number;
  ieStyle: IEStyle;
}

// Income/expense trailing windows offered in the chart's period dropdown
// (0 = all dates).
const IE_MONTHS: number[] = [6, 12, 24, 36, 0];

const VIEW_KEY = "cb.dashboard.view";
const DEFAULT_VIEW: DashView = {
  period: "thisMonth",
  chartType: "donut",
  groupBy: "category",
  ieMonths: 12,
  ieStyle: "bars",
};
// Periods offered for the spending widget (the register's "custom" range is
// omitted here to keep the dashboard control a single dropdown).
const PERIODS: DatePreset[] = ["thisMonth", "thisQuarter", "thisYear", "last30", "last90", "all"];

function loadView(): DashView {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (raw) return { ...DEFAULT_VIEW, ...(JSON.parse(raw) as Partial<DashView>) };
  } catch {
    /* ignore malformed storage */
  }
  return DEFAULT_VIEW;
}

// resolveBounds turns a preset into explicit inclusive YYYY-MM-DD bounds. "all"
// (and any open-ended preset) becomes wide sentinels so the request always
// carries a range and the server does not fall back to the current month.
function resolveBounds(period: DatePreset): { from: string; to: string } {
  if (period === "all") return { from: "0001-01-01", to: "9999-12-31" };
  const b = dateBounds({ ...emptyFilters, preset: period });
  return { from: b.from ?? "0001-01-01", to: b.to ?? "9999-12-31" };
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const { user } = useAuth();
  const qc = useQueryClient();
  const walletId = currentWallet?.id ?? 0;

  // Per-user dashboard layout: widget order, hidden ids, and per-widget width.
  const savedLayout = user?.preferences?.dashboardLayout;
  const [order, setOrder] = useState<WidgetId[]>(() => resolveLayout(savedLayout?.order));
  const [hidden, setHidden] = useState<string[]>(() => savedLayout?.hidden ?? []);
  const [spans, setSpans] = useState<Record<string, string>>(() => savedLayout?.spans ?? {});
  const [editingLayout, setEditingLayout] = useState(false);
  const persistLayout = useMutation({
    mutationFn: (next: { order: string[]; hidden: string[]; spans: Record<string, string> }) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), dashboardLayout: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The spending widget's period and chart options, remembered across reloads.
  const [view, setView] = useState<DashView>(loadView);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(view));
    } catch {
      /* ignore storage failures */
    }
  }, [view]);
  const { from, to } = resolveBounds(view.period);

  const query = useQuery({
    queryKey: ["dashboard", walletId, from, to, view.groupBy, view.ieMonths],
    queryFn: () => getDashboard(walletId, from, to, view.groupBy, view.ieMonths),
    enabled: walletId > 0,
  });
  const data = query.data;

  // Accounts shown on the home screen exclude closed and excluded-from-summary
  // accounts; group the rest by account type.
  const groups = useMemo(() => {
    const visible = (data?.accounts ?? []).filter((a) => !a.closed && !a.noSummary);
    const byType = new Map<string, DashboardAccount[]>();
    for (const a of visible) {
      const arr = byType.get(a.type) ?? [];
      arr.push(a);
      byType.set(a.type, arr);
    }
    return [...byType.entries()];
  }, [data]);

  if (!currentWallet) return null;
  const base = data?.baseCurrency ?? undefined;

  const hiddenSet = new Set(hidden);
  const visible = order.filter((id) => !hiddenSet.has(id));
  const hiddenIds = order.filter((id) => hiddenSet.has(id));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = order.indexOf(active.id as WidgetId);
    const newI = order.indexOf(over.id as WidgetId);
    if (oldI < 0 || newI < 0) return;
    const next = arrayMove(order, oldI, newI);
    setOrder(next);
    persistLayout.mutate({ order: next, hidden, spans });
  };
  const setVisibility = (id: WidgetId, hide: boolean) => {
    const next = hide ? [...hidden, id] : hidden.filter((x) => x !== id);
    setHidden(next);
    persistLayout.mutate({ order, hidden: next, spans });
  };
  const setSpan = (id: WidgetId, size: WidgetSize) => {
    const next = { ...spans, [id]: size };
    setSpans(next);
    persistLayout.mutate({ order, hidden, spans: next });
  };
  // Per-widget width → Mantine 12-column span (full screen-wide on small screens).
  const sizeOf = (id: WidgetId): WidgetSize => (spans[id] as WidgetSize) ?? "full";
  const spanCols = (id: WidgetId): number => {
    const s = sizeOf(id);
    return s === "half" ? 6 : s === "third" ? 4 : 12;
  };

  const widgets: Record<WidgetId, ReactNode> = {
    totals:
      base && data ? (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TotalCard label={t("register.bank")} value={data.totals.bank} fmt={base} />
          <TotalCard label={t("register.today")} value={data.totals.today} fmt={base} />
          <TotalCard label={t("register.future")} value={data.totals.future} fmt={base} />
        </SimpleGrid>
      ) : null,
    quickAdd: <QuickAddCard walletId={walletId} />,
    incomeExpense: (
      <IncomeExpenseCard
        view={view}
        setView={setView}
        points={data?.incomeExpense ?? []}
        base={base}
      />
    ),
    accounts: <AccountsPanel groups={groups} base={base} totals={data?.totals} />,
    spending: (
      <SpendingCard view={view} setView={setView} slices={data?.topCategories ?? []} base={base} />
    ),
    upcoming: <UpcomingPanel walletId={walletId} base={base} />,
  };
  const labels: Record<WidgetId, string> = {
    totals: t("dashboard.widgets.totals"),
    quickAdd: t("dashboard.quickAdd"),
    incomeExpense: t("dashboard.incomeExpense"),
    accounts: t("dashboard.yourAccounts"),
    spending: t("dashboard.whereMoneyGoes"),
    upcoming: t("dashboard.upcoming"),
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("dashboard.title")}</Title>
        <Button
          variant={editingLayout ? "light" : "subtle"}
          color="gray"
          size="xs"
          leftSection={<IconAdjustmentsHorizontal size={16} />}
          onClick={() => setEditingLayout((v) => !v)}
          data-tour="customize"
        >
          {editingLayout ? t("dashboard.layoutDone") : t("dashboard.customize")}
        </Button>
      </Group>

      {editingLayout ? (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible} strategy={rectSortingStrategy}>
              <Grid gutter="md">
                {visible.map((id) => (
                  <SortableWidget
                    key={id}
                    id={id}
                    label={labels[id]}
                    cols={spanCols(id)}
                    size={sizeOf(id)}
                    onHide={() => setVisibility(id, true)}
                    onSize={(s) => setSpan(id, s)}
                  >
                    {widgets[id]}
                  </SortableWidget>
                ))}
              </Grid>
            </SortableContext>
          </DndContext>
          {hiddenIds.length > 0 && (
            <Card withBorder>
              <Text size="sm" fw={600} c="dimmed" mb="xs">
                {t("dashboard.hiddenWidgets")}
              </Text>
              <Group gap="xs">
                {hiddenIds.map((id) => (
                  <Button
                    key={id}
                    variant="default"
                    size="xs"
                    leftSection={<IconEye size={14} />}
                    onClick={() => setVisibility(id as WidgetId, false)}
                  >
                    {labels[id as WidgetId]}
                  </Button>
                ))}
              </Group>
            </Card>
          )}
        </>
      ) : (
        <Grid gutter="md">
          {visible.map((id) => (
            <Grid.Col key={id} span={{ base: 12, sm: spanCols(id) }}>
              {widgets[id]}
            </Grid.Col>
          ))}
        </Grid>
      )}
    </Stack>
  );
}

// SortableWidget wraps a dashboard widget in edit mode within a grid column: a
// drag handle reorders it, a size control sets its width, and a hide button
// removes it. The content is non-interactive while editing.
function SortableWidget({
  id,
  label,
  cols,
  size,
  onHide,
  onSize,
  children,
}: {
  id: string;
  label: string;
  cols: number;
  size: WidgetSize;
  onHide: () => void;
  onSize: (s: WidgetSize) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 2 : undefined,
  };
  return (
    <Grid.Col span={{ base: 12, sm: cols }} ref={setNodeRef} style={style}>
      <Group
        justify="space-between"
        wrap="nowrap"
        mb={4}
        px="xs"
        py={4}
        bg="var(--mantine-color-default-hover)"
        style={{ borderRadius: "var(--mantine-radius-sm)" }}
      >
        <Group gap="xs" wrap="nowrap">
          <Box
            {...attributes}
            {...listeners}
            style={{ cursor: "grab", display: "flex" }}
            aria-label={t("nav.drag")}
          >
            <IconGripVertical size={16} opacity={0.6} />
          </Box>
          <Text size="sm" fw={600}>
            {label}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={size}
            onChange={(v) => onSize(v as WidgetSize)}
            data={[
              { value: "full", label: "1/1" },
              { value: "half", label: "1/2" },
              { value: "third", label: "1/3" },
            ]}
          />
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={t("dashboard.hideWidget")}
            onClick={onHide}
          >
            <IconEyeOff size={16} />
          </ActionIcon>
        </Group>
      </Group>
      <Box style={{ pointerEvents: "none" }}>{children}</Box>
    </Grid.Col>
  );
}

// AccountsPanel groups the home-screen accounts by type with per-group subtotals
// and a base-currency grand total.
function AccountsPanel({
  groups,
  base,
  totals,
}: {
  groups: [string, DashboardAccount[]][];
  base?: CurrencyInfo;
  totals?: { bank: number; today: number; future: number };
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {t("dashboard.yourAccounts")}
      </Title>
      {groups.length === 0 && <Text c="dimmed">{t("dashboard.noAccounts")}</Text>}
      <Stack gap="lg">
        {groups.map(([type, accounts]) => (
          <div key={type}>
            <Text size="sm" fw={600} c="dimmed" tt="uppercase" mb={4}>
              {t(`accounts.types.${type}`)}
            </Text>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("accounts.name")}</Table.Th>
                  <Table.Th ta="right">{t("register.bank")}</Table.Th>
                  <Table.Th ta="right">{t("register.today")}</Table.Th>
                  <Table.Th ta="right">{t("register.future")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {accounts.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>{a.name}</Table.Td>
                    <Table.Td ta="right">{formatMinor(a.bank, a.currency)}</Table.Td>
                    <Table.Td ta="right">{formatMinor(a.today, a.currency)}</Table.Td>
                    <Table.Td ta="right" c={a.future < 0 ? "red" : undefined}>
                      {formatMinor(a.future, a.currency)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <GroupSubtotal accounts={accounts} />
            </Table>
          </div>
        ))}
        {base && totals && groups.length > 0 && (
          <Group justify="space-between" pt="xs" wrap="nowrap">
            <Text fw={700}>{t("dashboard.total")}</Text>
            <Group gap="lg" wrap="nowrap">
              <Text fw={700}>{formatMinor(totals.bank, base)}</Text>
              <Text fw={700}>{formatMinor(totals.today, base)}</Text>
              <Text fw={700} c={totals.future < 0 ? "red" : undefined}>
                {formatMinor(totals.future, base)}
              </Text>
            </Group>
          </Group>
        )}
      </Stack>
    </Card>
  );
}

// SpendingCard is the spending breakdown with its period and chart-option
// controls.
function SpendingCard({
  view,
  setView,
  slices,
  base,
}: {
  view: DashView;
  setView: (v: DashView) => void;
  slices: { categoryId: number; name: string; amount: number }[];
  base?: CurrencyInfo;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.whereMoneyGoes")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("dashboard.period")}
            data={PERIODS.map((p) => ({ value: p, label: t(`filters.presets.${p}`) }))}
            value={view.period}
            onChange={(v) => v && setView({ ...view, period: v as DatePreset })}
            allowDeselect={false}
            w={150}
          />
          <Menu position="bottom-end" withinPortal closeOnItemClick={false}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t("dashboard.chartOptions")}
              >
                <IconAdjustmentsHorizontal size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t("dashboard.chartType")}</Menu.Label>
              <Box px="sm" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={view.chartType}
                  onChange={(v) => setView({ ...view, chartType: v as ChartType })}
                  data={[
                    { value: "donut", label: t("dashboard.chartDonut") },
                    { value: "bar", label: t("dashboard.chartBar") },
                  ]}
                />
              </Box>
              <Menu.Label>{t("dashboard.groupBy")}</Menu.Label>
              <Box px="sm" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={view.groupBy}
                  onChange={(v) => setView({ ...view, groupBy: v as DashboardGroupBy })}
                  data={[
                    { value: "category", label: t("dashboard.byCategory") },
                    { value: "payee", label: t("dashboard.byPayee") },
                  ]}
                />
              </Box>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <SpendingChart slices={slices} base={base} chartType={view.chartType} />
    </Card>
  );
}

// IncomeExpenseCard is the income/expense-over-time widget: a HomeBank-style
// diverging chart (income up, expense down) with a period dropdown and a gear to
// switch between bars and lines.
function IncomeExpenseCard({
  view,
  setView,
  points,
  base,
}: {
  view: DashView;
  setView: (v: DashView) => void;
  points: MonthPoint[];
  base?: CurrencyInfo;
}) {
  const { t } = useTranslation();
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.incomeExpense")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("dashboard.period")}
            data={IE_MONTHS.map((m) => ({
              value: String(m),
              label: m === 0 ? t("filters.presets.all") : t("dashboard.lastMonths", { count: m }),
            }))}
            value={String(view.ieMonths)}
            onChange={(v) => v != null && setView({ ...view, ieMonths: Number(v) })}
            allowDeselect={false}
            w={160}
          />
          <Menu position="bottom-end" withinPortal closeOnItemClick={false}>
            <Menu.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                aria-label={t("dashboard.chartOptions")}
              >
                <IconAdjustmentsHorizontal size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t("dashboard.chartType")}</Menu.Label>
              <Box px="sm" pb="xs">
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={view.ieStyle}
                  onChange={(v) => setView({ ...view, ieStyle: v as IEStyle })}
                  data={[
                    { value: "bars", label: t("dashboard.chartBar") },
                    { value: "lines", label: t("dashboard.chartLines") },
                  ]}
                />
              </Box>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <IncomeExpenseChart points={points} base={base} style={view.ieStyle} />
    </Card>
  );
}

// IncomeExpenseChart plots income above the zero line (green) and expense below
// it (red), as bars or lines, over the month axis — mirroring the HomeBank
// desktop "income vs expense" chart.
function IncomeExpenseChart({
  points,
  base,
  style,
}: {
  points: MonthPoint[];
  base?: CurrencyInfo;
  style: IEStyle;
}) {
  const { t } = useTranslation();
  const incomeLabel = t("dashboard.income");
  const expenseLabel = t("dashboard.expense");

  const option: EChartsOption = useMemo(() => {
    const seriesType = style === "lines" ? "line" : "bar";
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => {
          const n = typeof v === "number" ? v : Number(v) || 0;
          return base ? formatMinor(Math.abs(n), base) : String(Math.abs(n));
        },
      },
      legend: { data: [incomeLabel, expenseLabel], bottom: 0 },
      grid: { left: 8, right: 16, top: 16, bottom: 48, containLabel: true },
      xAxis: {
        type: "category",
        data: points.map((p) => p.month),
        axisLabel: { rotate: points.length > 14 ? 60 : 30 },
      },
      yAxis: { type: "value" },
      series: [
        {
          name: incomeLabel,
          type: seriesType,
          color: "#37b24d",
          data: points.map((p) => p.income),
        },
        {
          name: expenseLabel,
          type: seriesType,
          color: "#f03e3e",
          data: points.map((p) => -p.expense),
        },
      ],
    };
  }, [points, base, style, incomeLabel, expenseLabel]);

  const empty = points.every((p) => p.income === 0 && p.expense === 0);
  if (!base || empty) {
    return <Text c="dimmed">{t("dashboard.noSpending")}</Text>;
  }
  return <Chart option={option} height={340} />;
}

// GroupSubtotal renders a table footer summing a same-type group's balances. It
// is skipped for single-account groups (the row already shows the total) and
// when the group mixes currencies (a raw sum would be meaningless).
function GroupSubtotal({ accounts }: { accounts: DashboardAccount[] }) {
  const { t } = useTranslation();
  const cur = accounts[0]?.currency;
  const mixed = accounts.some((a) => a.currencyId !== accounts[0]?.currencyId);
  if (!cur || mixed || accounts.length < 2) return null;
  const bank = accounts.reduce((s, a) => s + a.bank, 0);
  const today = accounts.reduce((s, a) => s + a.today, 0);
  const future = accounts.reduce((s, a) => s + a.future, 0);
  return (
    <Table.Tfoot>
      <Table.Tr>
        <Table.Td fw={600}>{t("dashboard.subtotal")}</Table.Td>
        <Table.Td ta="right" fw={600}>
          {formatMinor(bank, cur)}
        </Table.Td>
        <Table.Td ta="right" fw={600}>
          {formatMinor(today, cur)}
        </Table.Td>
        <Table.Td ta="right" fw={600} c={future < 0 ? "red" : undefined}>
          {formatMinor(future, cur)}
        </Table.Td>
      </Table.Tr>
    </Table.Tfoot>
  );
}

// UpcomingPanel lists scheduled transactions in three tabs — the next due
// occurrences (with Post now / Skip), every active schedule, and the manual
// reminders — fed by the schedules list so actions can refresh it directly.
function UpcomingPanel({ walletId, base }: { walletId: number; base?: CurrencyInfo }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const schedulesQuery = useQuery({
    queryKey: ["schedules", walletId],
    queryFn: () => listSchedules(walletId),
    enabled: walletId > 0,
  });
  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sortByDue = (a: Schedule, b: Schedule) => a.nextDue.localeCompare(b.nextDue);
  // Mirror HomeBank's bottom panel. remaining === 0 is exhausted and hidden
  // everywhere. Auto-post schedules split into those due now/overdue (Recurring —
  // ready to post) and those still ahead (Future); manual schedules are Reminders.
  const recurring = useMemo(
    () =>
      schedules
        .filter((s) => s.autoPost && s.remaining !== 0 && s.nextDue <= today)
        .sort(sortByDue),
    [schedules, today],
  );
  const future = useMemo(
    () =>
      schedules.filter((s) => s.autoPost && s.remaining !== 0 && s.nextDue > today).sort(sortByDue),
    [schedules, today],
  );
  const reminders = useMemo(
    () => schedules.filter((s) => !s.autoPost && s.remaining !== 0).sort(sortByDue),
    [schedules],
  );

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["schedules", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
  };
  const post = useMutation({
    mutationFn: (id: number) => postScheduleNow(walletId, id),
    onSuccess: refresh,
    onError,
  });
  const skip = useMutation({
    mutationFn: (id: number) => skipSchedule(walletId, id),
    onSuccess: refresh,
    onError,
  });

  // Each row offers post / skip / edit-before-post (edit opens the Schedules page).
  const row = (s: Schedule) => (
    <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs">
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" truncate>
          {s.templateName || t("schedules.untitled")}
        </Text>
        <Text size="xs" c="dimmed">
          {fmtDate(s.nextDue)}
          {` · ${t("schedules.cadence", { n: s.everyN, unit: t(`schedules.units.${s.unit}`) })}`}
        </Text>
      </Box>
      <Group gap={4} wrap="nowrap">
        {base && (
          <Text size="sm" fw={500} c={s.templateAmount < 0 ? "red" : "teal"}>
            {formatMinor(s.templateAmount, base)}
          </Text>
        )}
        <ActionIcon
          variant="subtle"
          size="sm"
          color="teal"
          aria-label={t("schedules.postNow")}
          loading={post.isPending && post.variables === s.id}
          onClick={() => post.mutate(s.id)}
        >
          <IconPlayerPlay size={15} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          size="sm"
          color="gray"
          aria-label={t("schedules.skip")}
          loading={skip.isPending && skip.variables === s.id}
          onClick={() => skip.mutate(s.id)}
        >
          <IconPlayerSkipForward size={15} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={t("schedules.edit")}
          onClick={() => navigate("/schedules")}
        >
          <IconPencil size={14} />
        </ActionIcon>
      </Group>
    </Group>
  );

  const tabLabel = (label: string, count: number) => (
    <Group gap={6} wrap="nowrap">
      {label}
      {count > 0 && (
        <Badge size="xs" variant="light" color="gray">
          {count}
        </Badge>
      )}
    </Group>
  );
  const list = (items: Schedule[], emptyMsg: string) =>
    items.length === 0 ? (
      <Text c="dimmed">{emptyMsg}</Text>
    ) : (
      <Stack gap={8}>{items.map((s) => row(s))}</Stack>
    );

  return (
    <Card withBorder>
      <Title order={4} mb="sm">
        {t("dashboard.upcoming")}
      </Title>
      <Tabs defaultValue="recurring">
        <Tabs.List mb="sm">
          <Tabs.Tab value="recurring">
            {tabLabel(t("dashboard.tabRecurring"), recurring.length)}
          </Tabs.Tab>
          <Tabs.Tab value="future">{tabLabel(t("dashboard.tabFuture"), future.length)}</Tabs.Tab>
          <Tabs.Tab value="reminders">
            {tabLabel(t("dashboard.tabReminders"), reminders.length)}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="recurring">{list(recurring, t("dashboard.noRecurring"))}</Tabs.Panel>
        <Tabs.Panel value="future">{list(future, t("dashboard.noFuture"))}</Tabs.Panel>
        <Tabs.Panel value="reminders">{list(reminders, t("dashboard.noReminders"))}</Tabs.Panel>
      </Tabs>
    </Card>
  );
}

// QuickAddCard mirrors HomeBank: pick an account and "Add" opens the full
// transaction modal (the same one the register uses); totals/balances refresh
// on save.
function QuickAddCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [opened, modal] = useDisclosure(false);
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const templatesQuery = useQuery({
    queryKey: ["templates", walletId],
    queryFn: () => listTemplates(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter((a) => !a.closed),
    [accountsQuery.data],
  );
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (accountId || accounts.length === 0) return;
    const pref = user?.preferences?.defaultAccountId;
    const initial = pref && accounts.some((a) => a.id === pref) ? pref : accounts[0].id;
    setAccountId(String(initial));
  }, [accounts, accountId, user]);

  const account = accounts.find((a) => String(a.id) === accountId);
  if (accounts.length === 0) return null;

  const onSaved = () => {
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
    modal.close();
  };

  return (
    <Card withBorder data-tour="quick-add">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Title order={4}>{t("dashboard.addTransaction")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("transactions.account")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={accountId}
            onChange={setAccountId}
            allowDeselect={false}
            searchable
            w={220}
          />
          <Button leftSection={<IconPlus size={16} />} onClick={modal.open} disabled={!account}>
            {t("dashboard.addTransaction")}
          </Button>
        </Group>
      </Group>
      {account && (
        <TransactionForm
          opened={opened}
          onClose={modal.close}
          walletId={walletId}
          account={account}
          editing={null}
          onSaved={onSaved}
          templates={templatesQuery.data ?? []}
          onTemplateSaved={() => void qc.invalidateQueries({ queryKey: ["templates", walletId] })}
        />
      )}
    </Card>
  );
}

function TotalCard({ label, value, fmt }: { label: string; value: number; fmt: CurrencyInfo }) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label} · {fmt.code}
      </Text>
      <Text size="xl" fw={700} c={value < 0 ? "red" : undefined}>
        {formatMinor(value, fmt)}
      </Text>
    </Card>
  );
}

// SpendingChart renders the spending breakdown either as the SVG donut with a
// legend or as a horizontal ECharts bar; both share the same colours and the
// rolled-up "Other" slice (categoryId/payeeId 0).
function SpendingChart({
  slices,
  base,
  chartType,
}: {
  slices: { categoryId: number; name: string; amount: number }[];
  base?: CurrencyInfo;
  chartType: ChartType;
}) {
  const { t } = useTranslation();

  const data = useMemo(
    () =>
      slices.map((s, i) => ({
        label: s.categoryId === 0 ? t("dashboard.other") : s.name,
        value: s.amount,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      })),
    [slices, t],
  );

  const barOption: EChartsOption = useMemo(() => {
    // Reverse so the largest slice sits at the top of the (bottom-up) y-axis.
    const ordered = [...data].reverse();
    return {
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) =>
          base ? formatMinor(typeof v === "number" ? v : Number(v) || 0, base) : String(v),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
      xAxis: { type: "value" },
      yAxis: { type: "category", data: ordered.map((d) => d.label) },
      series: [
        {
          type: "bar",
          data: ordered.map((d) => ({ value: d.value, itemStyle: { color: d.color } })),
        },
      ],
    };
  }, [data, base]);

  if (slices.length === 0 || !base) {
    return <Text c="dimmed">{t("dashboard.noSpending")}</Text>;
  }

  if (chartType === "bar") {
    return <Chart option={barOption} height={Math.max(180, data.length * 34)} />;
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <Group align="center" wrap="wrap" gap="xl">
      <Donut data={data} />
      <Stack gap={4} style={{ flex: 1, minWidth: 200 }}>
        {data.map((d) => (
          <Group key={d.label} justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: d.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              <Text size="sm" truncate>
                {d.label}
              </Text>
            </Group>
            <Group gap={10} wrap="nowrap">
              <Text size="sm" fw={500}>
                {formatMinor(d.value, base)}
              </Text>
              <Text size="xs" c="dimmed" w={36} ta="right">
                {total > 0 ? Math.round((d.value / total) * 100) : 0}%
              </Text>
            </Group>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}
