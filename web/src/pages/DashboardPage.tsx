import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Menu,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconAdjustmentsHorizontal,
  IconEyeOff,
  IconGripVertical,
  IconPencil,
  IconPlayerPlay,
  IconPlayerSkipForward,
  IconPlus,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  getBudgetReport,
  getDashboard,
  listAccounts,
  listSchedules,
  listTemplates,
  postScheduleNow,
  skipSchedule,
  updateMe,
} from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { BudgetGauge } from "../components/BudgetGauge";
import { Chart } from "../components/Chart";
import { Donut } from "../components/Donut";
import { GridDashboard } from "../components/dashboard/GridDashboard";
import {
  type DashboardLayoutV2,
  type PlacedWidget,
  WIDGET_SIZES,
  WIDGET_TYPES,
  type WidgetType,
  migrateLayout,
  newInstanceId,
} from "../components/dashboard/layout";
import { useDateFormat } from "../dates";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
import { TransactionForm } from "../components/TransactionForm";
import { type DatePreset, dateBounds, emptyFilters } from "./registerFilters";

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

// Income/expense trailing windows offered in the chart's period dropdown
// (0 = all dates).
const IE_MONTHS: number[] = [6, 12, 24, 36, 0];

// Periods offered for the spending widget (the register's "custom" range is
// omitted here to keep the dashboard control a single dropdown).
const PERIODS: DatePreset[] = ["thisMonth", "thisQuarter", "thisYear", "last30", "last90", "all"];

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

  // Per-user dashboard layout: a free-form 2D grid of placed widgets. The legacy
  // { order, hidden, spans } model is migrated on load (see layout.ts).
  const [layout, setLayout] = useState<DashboardLayoutV2>(() =>
    migrateLayout(user?.preferences?.dashboardLayout),
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [editingLayout, setEditingLayout] = useState(false);
  const persistLayout = useMutation({
    mutationFn: (next: DashboardLayoutV2) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), dashboardLayout: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });
  // Debounce persistence so a drag/resize burst is a single network write.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commitLayout = (next: DashboardLayoutV2) => {
    setLayout(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistLayout.mutate(next), 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Base dashboard query for the wallet-wide widgets (totals, accounts, base
  // currency), independent of any widget's period. The spending / income-expense
  // widgets fetch their own slices from their per-instance config.
  const query = useQuery({
    queryKey: ["dashboard", walletId, "0001-01-01", "9999-12-31", "category", 12],
    queryFn: () => getDashboard(walletId, "0001-01-01", "9999-12-31", "category", 12),
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

  const base = data?.baseCurrency ?? undefined;

  // Render one placed widget instance by type, passing its per-instance config.
  const renderWidget = (item: PlacedWidget): ReactNode => {
    switch (item.type) {
      case "totals":
        return base && data ? (
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <TotalCard label={t("register.bank")} value={data.totals.bank} fmt={base} />
            <TotalCard label={t("register.today")} value={data.totals.today} fmt={base} />
            <TotalCard label={t("register.future")} value={data.totals.future} fmt={base} />
          </SimpleGrid>
        ) : null;
      case "quickAdd":
        return <QuickAddCard walletId={walletId} />;
      case "incomeExpense":
        return (
          <IncomeExpenseCard
            walletId={walletId}
            base={base}
            config={{ ...DEFAULT_IE, ...(item.config as Partial<IEConfig>) }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "accounts":
        return <AccountsPanel groups={groups} base={base} totals={data?.totals} />;
      case "spending":
        return (
          <SpendingCard
            walletId={walletId}
            base={base}
            config={{ ...DEFAULT_SPENDING, ...(item.config as Partial<SpendingConfig>) }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "budget":
        return <BudgetWidget walletId={walletId} base={base} />;
      case "upcoming":
        return <UpcomingPanel walletId={walletId} base={base} />;
    }
  };

  if (!currentWallet) return null;

  // Merge gridstack's new positions back into the placed widgets.
  const applyGridChange = (
    positions: { id: string; x: number; y: number; w: number; h: number }[],
  ) => {
    const byId = new Map(positions.map((p) => [p.id, p]));
    commitLayout({
      version: 2,
      widgets: layoutRef.current.widgets.map((wgt) => {
        const p = byId.get(wgt.id);
        return p ? { ...wgt, x: p.x, y: p.y, w: p.w, h: p.h } : wgt;
      }),
    });
  };

  const addWidget = (type: WidgetType) => {
    const size = WIDGET_SIZES[type];
    // Place the new instance on a fresh row below everything else.
    const bottom = layoutRef.current.widgets.reduce((m, wgt) => Math.max(m, wgt.y + wgt.h), 0);
    const placed: PlacedWidget = {
      id: newInstanceId(type, layoutRef.current.widgets),
      type,
      x: 0,
      y: bottom,
      w: size.w,
      h: size.h,
    };
    commitLayout({ version: 2, widgets: [...layoutRef.current.widgets, placed] });
  };

  const removeWidget = (id: string) => {
    commitLayout({ version: 2, widgets: layoutRef.current.widgets.filter((wgt) => wgt.id !== id) });
  };

  const setConfig = (id: string, config: Record<string, unknown>) => {
    commitLayout({
      version: 2,
      widgets: layoutRef.current.widgets.map((wgt) => (wgt.id === id ? { ...wgt, config } : wgt)),
    });
  };

  const labels: Record<WidgetType, string> = {
    totals: t("dashboard.widgets.totals"),
    quickAdd: t("dashboard.quickAdd"),
    incomeExpense: t("dashboard.incomeExpense"),
    accounts: t("dashboard.yourAccounts"),
    spending: t("dashboard.whereMoneyGoes"),
    budget: t("dashboard.budget"),
    upcoming: t("dashboard.upcoming"),
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("dashboard.title")}</Title>
        <Group gap="xs">
          {editingLayout && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button variant="default" size="xs" leftSection={<IconPlus size={16} />}>
                  {t("dashboard.addWidget")}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {WIDGET_TYPES.map((type) => (
                  <Menu.Item key={type} onClick={() => addWidget(type)}>
                    {labels[type]}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
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
      </Group>

      {editingLayout && (
        <Text size="xs" c="dimmed">
          {t("dashboard.editHint")}
        </Text>
      )}

      <GridDashboard
        items={layout.widgets}
        editing={editingLayout}
        onChange={applyGridChange}
        sizes={WIDGET_SIZES}
        render={(item) => (
          <WidgetFrame
            editing={editingLayout}
            label={labels[item.type]}
            onRemove={() => removeWidget(item.id)}
          >
            {renderWidget(item)}
          </WidgetFrame>
        )}
      />
    </Stack>
  );
}

// WidgetFrame fills its grid cell. In edit mode it shows a header bar (drag
// affordance + remove button); the remove button stops pointer events from
// starting a gridstack drag.
function WidgetFrame({
  editing,
  label,
  onRemove,
  children,
}: {
  editing: boolean;
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {editing && (
        <Group
          justify="space-between"
          wrap="nowrap"
          px="xs"
          py={4}
          bg="var(--mantine-color-default-hover)"
          style={{
            borderTopLeftRadius: "var(--mantine-radius-md)",
            borderTopRightRadius: "var(--mantine-radius-md)",
          }}
        >
          <Group gap={4} wrap="nowrap">
            <IconGripVertical size={14} opacity={0.6} />
            <Text size="xs" fw={600} c="dimmed" lineClamp={1}>
              {label}
            </Text>
          </Group>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label={label}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            <IconEyeOff size={14} />
          </ActionIcon>
        </Group>
      )}
      <Box style={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Box>
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
type SpendingConfig = { period: DatePreset; chartType: ChartType; groupBy: DashboardGroupBy };
const DEFAULT_SPENDING: SpendingConfig = {
  period: "thisMonth",
  chartType: "donut",
  groupBy: "category",
};

// SpendingCard is self-contained: it fetches its own top-categories slice for
// its configured period/dimension, so multiple instances are independent.
function SpendingCard({
  walletId,
  base,
  config,
  onConfig,
}: {
  walletId: number;
  base?: CurrencyInfo;
  config: SpendingConfig;
  onConfig: (c: SpendingConfig) => void;
}) {
  const { t } = useTranslation();
  const { from, to } = resolveBounds(config.period);
  const q = useQuery({
    queryKey: ["dashboard", walletId, from, to, config.groupBy, 12],
    queryFn: () => getDashboard(walletId, from, to, config.groupBy, 12),
    enabled: walletId > 0,
  });
  const slices = q.data?.topCategories ?? [];
  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="xs">
        <Title order={4}>{t("dashboard.whereMoneyGoes")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("dashboard.period")}
            data={PERIODS.map((p) => ({ value: p, label: t(`filters.presets.${p}`) }))}
            value={config.period}
            onChange={(v) => v && onConfig({ ...config, period: v as DatePreset })}
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
                  value={config.chartType}
                  onChange={(v) => onConfig({ ...config, chartType: v as ChartType })}
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
                  value={config.groupBy}
                  onChange={(v) => onConfig({ ...config, groupBy: v as DashboardGroupBy })}
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
      <SpendingChart slices={slices} base={base} chartType={config.chartType} />
    </Card>
  );
}

// IncomeExpenseCard is the income/expense-over-time widget: a HomeBank-style
// diverging chart (income up, expense down) with a period dropdown and a gear to
// switch between bars and lines.
type IEConfig = { months: number; style: IEStyle; net: boolean; cumulative: boolean };
const DEFAULT_IE: IEConfig = { months: 12, style: "bars", net: false, cumulative: false };

// IncomeExpenseCard is self-contained: it fetches its own income/expense series
// for its configured trailing window, so multiple instances are independent.
function IncomeExpenseCard({
  walletId,
  base,
  config,
  onConfig,
}: {
  walletId: number;
  base?: CurrencyInfo;
  config: IEConfig;
  onConfig: (c: IEConfig) => void;
}) {
  const { t } = useTranslation();
  // The income/expense series depends only on the trailing-month window, so the
  // range is left wide (it drives topCategories, unused here).
  const q = useQuery({
    queryKey: ["dashboard", walletId, "0001-01-01", "9999-12-31", "category", config.months],
    queryFn: () => getDashboard(walletId, "0001-01-01", "9999-12-31", "category", config.months),
    enabled: walletId > 0,
  });
  const points = q.data?.incomeExpense ?? [];
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
            value={String(config.months)}
            onChange={(v) => v != null && onConfig({ ...config, months: Number(v) })}
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
                  value={config.style}
                  onChange={(v) => onConfig({ ...config, style: v as IEStyle })}
                  data={[
                    { value: "bars", label: t("dashboard.chartBar") },
                    { value: "lines", label: t("dashboard.chartLines") },
                  ]}
                />
              </Box>
              <Box px="sm" pb="xs">
                <Switch
                  size="xs"
                  label={t("dashboard.showNet")}
                  checked={config.net}
                  onChange={(e) => onConfig({ ...config, net: e.currentTarget.checked })}
                />
                <Switch
                  size="xs"
                  mt={6}
                  label={t("dashboard.cumulative")}
                  checked={config.cumulative}
                  disabled={!config.net}
                  onChange={(e) => onConfig({ ...config, cumulative: e.currentTarget.checked })}
                />
              </Box>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <IncomeExpenseChart
        points={points}
        base={base}
        style={config.style}
        showNet={config.net}
        cumulative={config.cumulative}
      />
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
  showNet,
  cumulative,
}: {
  points: MonthPoint[];
  base?: CurrencyInfo;
  style: IEStyle;
  showNet: boolean;
  cumulative: boolean;
}) {
  const { t } = useTranslation();
  const incomeLabel = t("dashboard.income");
  const expenseLabel = t("dashboard.expense");
  const netLabel = cumulative ? t("dashboard.netCumulative") : t("dashboard.net");

  const option: EChartsOption = useMemo(() => {
    const seriesType = style === "lines" ? "line" : "bar";
    // Net per month = income − expense (both stored as positive magnitudes);
    // optionally accumulated into a running total across the window.
    let acc = 0;
    const net = points.map((p) => {
      const m = p.income - p.expense;
      acc += m;
      return cumulative ? acc : m;
    });
    const legend = showNet ? [incomeLabel, expenseLabel, netLabel] : [incomeLabel, expenseLabel];
    return {
      tooltip: {
        trigger: "axis",
        // Income/expense bars show their magnitude; the net line keeps its sign.
        formatter: (params) => {
          const arr = Array.isArray(params) ? params : [params];
          // axisValue is present at runtime for axis-trigger tooltips but not on
          // the base param type; read it through a narrow cast.
          const head = arr.length
            ? String((arr[0] as { axisValue?: string | number }).axisValue ?? "")
            : "";
          const lines = arr.map((p) => {
            const raw = typeof p.value === "number" ? p.value : Number(p.value) || 0;
            const v = p.seriesName === netLabel ? raw : Math.abs(raw);
            const text = base ? formatMinor(v, base) : String(v);
            return `${p.marker ?? ""}${p.seriesName}: ${text}`;
          });
          return [head, ...lines].join("<br/>");
        },
      },
      legend: { data: legend, bottom: 0 },
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
        ...(showNet
          ? [
              {
                name: netLabel,
                type: "line" as const,
                color: "#1c7ed6",
                smooth: true,
                symbolSize: 6,
                z: 3,
                data: net,
              },
            ]
          : []),
      ],
    };
  }, [points, base, style, showNet, cumulative, incomeLabel, expenseLabel, netLabel]);

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

// BudgetWidget shows this month's combined expense budget vs actual as an
// over/under progress gauge, from the budget report (rolled up).
function BudgetWidget({ walletId, base }: { walletId: number; base?: CurrencyInfo }) {
  const { t } = useTranslation();
  const { from, to } = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = now.getFullYear();
    const m = now.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
  }, []);
  const query = useQuery({
    queryKey: ["budgetReport", walletId, from, to, true],
    queryFn: () => getBudgetReport(walletId, from, to, true),
    enabled: walletId > 0,
  });
  // Combined expense budget vs actual (magnitudes), over the non-income rows.
  const { budget, actual } = useMemo(() => {
    let budget = 0;
    let actual = 0;
    for (const r of query.data?.rows ?? []) {
      if (r.isIncome) continue;
      budget += Math.abs(r.budget);
      actual += Math.abs(r.actual);
    }
    return { budget, actual };
  }, [query.data]);

  return (
    <Card withBorder>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t("dashboard.budget")}</Title>
        <Text size="sm" c="dimmed">
          {t("dashboard.thisMonth")}
        </Text>
      </Group>
      {budget === 0 || !base ? (
        <Text c="dimmed">{t("budget.noBudgetSet")}</Text>
      ) : (
        <BudgetGauge budget={budget} actual={actual} base={base} />
      )}
    </Card>
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
      <Stack gap="xs">
        <Title order={4}>{t("dashboard.addTransaction")}</Title>
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label={t("transactions.account")}
            data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
            value={accountId}
            onChange={setAccountId}
            allowDeselect={false}
            searchable
            style={{ flex: 1, minWidth: 0, maxWidth: 260 }}
          />
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={modal.open}
            disabled={!account}
            style={{ flexShrink: 0 }}
          >
            {t("dashboard.addTransaction")}
          </Button>
        </Group>
      </Stack>
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
