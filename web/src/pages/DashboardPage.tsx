import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Menu,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowsMinimize,
  IconEyeOff,
  IconGripVertical,
  IconInfoCircle,
  IconPlus,
  IconRestore,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/confirmContext";

import { type DashboardAccount, type User, getDashboard, updateMe } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { dateBounds, emptyFilters, type DatePreset } from "./registerFilterModel";
import { GridDashboard, type GridDashboardHandle } from "../components/dashboard/GridDashboard";
import { PageHeader } from "../components/PageHeader";
import { OverviewFigures } from "../components/dashboard/OverviewFigures";
import { pickBalances } from "../components/dashboard/overviewFigureModel";
import { NeedsAttention } from "../components/dashboard/NeedsAttention";
import {
  COLUMNS,
  type DashboardLayoutV2,
  type PlacedWidget,
  WIDGET_SIZES,
  WIDGET_TYPES,
  type WidgetType,
  defaultLayout,
  migrateLayout,
  newInstanceId,
  tidyLayout,
} from "../components/dashboard/layout";
import { AccountBalanceCard } from "../components/dashboard/widgets/AccountBalanceCard";
import { AccountsPanel } from "../components/dashboard/widgets/AccountsPanel";
import { BillsPanel } from "../components/dashboard/widgets/BillsPanel";
import { BudgetWidget } from "../components/dashboard/widgets/BudgetWidget";
import { BalanceSparklineCard } from "../components/dashboard/widgets/BalanceSparklineCard";
import { CategoryBudgetCard } from "../components/dashboard/widgets/CategoryBudgetCard";
import { CurrencyRatesCard } from "../components/dashboard/widgets/CurrencyRatesCard";
import { NetWorthTrendCard } from "../components/dashboard/widgets/NetWorthTrendCard";
import { SpendingHeatmapCard } from "../components/dashboard/widgets/SpendingHeatmapCard";
import { CashflowForecastCard } from "../components/dashboard/widgets/CashflowForecastCard";
import { UnclearedSummaryCard } from "../components/dashboard/widgets/UnclearedSummaryCard";
import { IncomeExpenseCard } from "../components/dashboard/widgets/IncomeExpenseCard";
import { KpiCard } from "../components/dashboard/widgets/KpiCard";
import { NotesCard } from "../components/dashboard/widgets/NotesCard";
import { QuickAddCard } from "../components/dashboard/widgets/QuickAddCard";
import { RecentTransactionsCard } from "../components/dashboard/widgets/RecentTransactionsCard";
import {
  DEFAULT_IE,
  DEFAULT_KPI,
  DEFAULT_SPENDING,
  PAGE_PERIODS,
  periodToMonths,
  type IEConfig,
  type KpiConfig,
  type SpendingConfig,
} from "../components/dashboard/widgets/shared";
import { SpendingCard } from "../components/dashboard/widgets/SpendingCard";
import { TotalsWidget } from "../components/dashboard/widgets/TotalsWidget";
import { UpcomingPanel } from "../components/dashboard/widgets/UpcomingPanel";
import { useWallet } from "../wallet/WalletProvider";

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const { currentWallet } = useWallet();
  const { user } = useAuth();
  const qc = useQueryClient();
  const walletId = currentWallet?.id ?? 0;

  // Per-user dashboard layout: a free-form 2D grid of placed widgets. The legacy
  // { order, hidden, spans } model is migrated on load (see layout.ts).
  const [layout, setLayout] = useState<DashboardLayoutV2>(() =>
    migrateLayout(user?.preferences?.dashboardLayout),
  );
  // The latest layout, for the handlers: gridstack fires several of them between
  // two renders and each has to see what the one before it did. `commitLayout`
  // is the only place the layout changes, and it writes both.
  const layoutRef = useRef(layout);
  const [editingLayout, setEditingLayout] = useState(false);
  // Imperative handle to the grid so the S/M/L preset buttons can resize a widget.
  const gridApi = useRef<GridDashboardHandle>(null);
  // How far back the overview is looking. Balances are always current — a
  // balance is not a period quantity — so this drives only the widgets that
  // actually cover a span of time, and each of those can pin its own.
  const pagePeriod = (user?.preferences?.dashboardPeriod ?? "all") as DatePreset;
  const persistPeriod = useMutation({
    mutationFn: (period: DatePreset) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), dashboardPeriod: period } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const persistLayout = useMutation({
    mutationFn: (next: DashboardLayoutV2) =>
      updateMe({ preferences: { ...(user?.preferences ?? {}), dashboardLayout: next } }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });
  // Debounce persistence so a drag/resize burst is a single network write.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commitLayout = (next: DashboardLayoutV2) => {
    layoutRef.current = next;
    setLayout(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistLayout.mutate(next), 500);
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Re-pack the current widgets into a clean, gap-free grid (non-destructive).
  const tidy = () => commitLayout(tidyLayout(layoutRef.current.widgets));
  // Restore the default widget set and arrangement (after a confirm).
  const resetToDefault = async () => {
    const ok = await confirm({
      title: t("dashboard.confirmResetTitle"),
      body: t("dashboard.confirmResetBody"),
      confirmLabel: t("dashboard.confirmResetAction"),
      danger: true,
    });
    if (ok) commitLayout(defaultLayout());
  };

  // Base dashboard query for the wallet-wide widgets (totals, accounts, base
  // currency), independent of any widget's period. The spending / income-expense
  // widgets fetch their own slices from their per-instance config.
  const query = useQuery({
    queryKey: ["dashboard", walletId, "0001-01-01", "9999-12-31", "category", 12],
    queryFn: () => getDashboard(walletId, "0001-01-01", "9999-12-31", "category", 12),
    enabled: walletId > 0,
  });
  const data = query.data;

  // A second slice, scoped to the period the reader picked, for the figures at
  // the head of the page. Balances are current whatever the period, so they come
  // from the query above; earned and spent are the period's own answer and have
  // to be asked for separately. The months requested cover the period exactly
  // (0 meaning every month there is), so summing whole months is not an
  // approximation: every preset here starts and ends on a month boundary.
  const periodBounds = useMemo(
    () => dateBounds({ ...emptyFilters, preset: pagePeriod }),
    [pagePeriod],
  );
  const periodQuery = useQuery({
    queryKey: ["dashboard", walletId, periodBounds.from ?? "", periodBounds.to ?? "", "period"],
    queryFn: () =>
      getDashboard(
        walletId,
        periodBounds.from,
        periodBounds.to,
        "category",
        periodToMonths(pagePeriod),
      ),
    enabled: walletId > 0,
  });

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
  const balances = pickBalances(user?.preferences?.registerBalances);

  // Render one placed widget instance by type, passing its per-instance config.
  const renderWidget = (item: PlacedWidget): ReactNode => {
    switch (item.type) {
      case "totals":
        return <TotalsWidget totals={data?.totals} base={base} />;
      case "quickAdd":
        return <QuickAddCard walletId={walletId} />;
      case "incomeExpense":
        return (
          <IncomeExpenseCard
            walletId={walletId}
            base={base}
            config={{ ...DEFAULT_IE, ...(item.config as Partial<IEConfig>) }}
            onConfig={(c) => setConfig(item.id, c)}
            pagePeriod={pagePeriod}
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
            pagePeriod={pagePeriod}
          />
        );
      case "budget":
        return <BudgetWidget walletId={walletId} base={base} />;
      case "upcoming":
        return <UpcomingPanel walletId={walletId} base={base} />;
      case "bills":
        return <BillsPanel walletId={walletId} />;
      case "accountBalance":
        return (
          <AccountBalanceCard
            walletId={walletId}
            config={(item.config ?? {}) as { accountId?: number }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "recentTransactions":
        return (
          <RecentTransactionsCard
            walletId={walletId}
            config={(item.config ?? {}) as { accountId?: number }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "kpi":
        return (
          <KpiCard
            data={data}
            base={base}
            config={{ ...DEFAULT_KPI, ...(item.config as Partial<KpiConfig>) }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "notes":
        return (
          <NotesCard
            config={(item.config ?? {}) as { text?: string }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "currencyRates":
        return <CurrencyRatesCard walletId={walletId} />;
      case "categoryBudget":
        return (
          <CategoryBudgetCard
            walletId={walletId}
            base={base}
            config={(item.config ?? {}) as { categoryId?: number }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "netWorthTrend":
        return <NetWorthTrendCard walletId={walletId} />;
      case "balanceSparkline":
        return (
          <BalanceSparklineCard
            walletId={walletId}
            config={(item.config ?? {}) as { accountId?: number }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
      case "spendingHeatmap":
        return <SpendingHeatmapCard walletId={walletId} />;
      case "uncleared":
        return <UnclearedSummaryCard walletId={walletId} />;
      case "cashflow":
        return (
          <CashflowForecastCard
            walletId={walletId}
            config={(item.config ?? {}) as { accountId?: number; days?: number }}
            onConfig={(c) => setConfig(item.id, c)}
          />
        );
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
    accountBalance: t("dashboard.accountBalance"),
    recentTransactions: t("dashboard.recentTransactions"),
    kpi: t("dashboard.kpi"),
    notes: t("dashboard.notes"),
    currencyRates: t("dashboard.currencyRates"),
    categoryBudget: t("dashboard.categoryBudget"),
    netWorthTrend: t("dashboard.netWorth"),
    balanceSparkline: t("dashboard.balanceSparkline"),
    spendingHeatmap: t("dashboard.spendingHeatmap"),
    uncleared: t("dashboard.uncleared"),
    cashflow: t("dashboard.cashflow"),
    bills: t("bills.title"),
  };

  return (
    <Stack>
      <PageHeader
        prominent
        tour="dashboard"
        title={t("dashboard.title")}
        hint={t(`overview.hint.${pagePeriod}`)}
        actions={
          <>
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
            {editingLayout && (
              <>
                <Button
                  variant="default"
                  size="xs"
                  leftSection={<IconArrowsMinimize size={16} />}
                  onClick={tidy}
                >
                  {t("dashboard.tidyLayout")}
                </Button>
                <Button
                  variant="default"
                  size="xs"
                  color="gray"
                  leftSection={<IconRestore size={16} />}
                  onClick={resetToDefault}
                >
                  {t("dashboard.resetLayout")}
                </Button>
              </>
            )}
            {/* Outlined beside the filled "Add transaction": the tile gives the
                page one action that matters and keeps the rest quieter. */}
            <Button
              variant={editingLayout ? "light" : "default"}
              color={editingLayout ? undefined : "gray"}
              leftSection={<IconAdjustmentsHorizontal size={15} />}
              onClick={() => setEditingLayout((v) => !v)}
              data-tour="customize"
            >
              {editingLayout ? t("dashboard.layoutDone") : t("overview.customise")}
            </Button>
            <Button component={Link} to="/transactions?new=1">
              {t("transactions.add")}
            </Button>
          </>
        }
      />

      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <SegmentedControl
          className="cb-period-switch"
          aria-label={t("dashboard.period")}
          value={pagePeriod}
          onChange={(v) => persistPeriod.mutate(v as DatePreset)}
          data={PAGE_PERIODS.map((p) => ({ value: p, label: t(`overview.period.${p}`) }))}
        />
      </Group>

      <OverviewFigures
        balances={balances}
        totals={data?.totals}
        base={base}
        points={periodQuery.data?.incomeExpense ?? []}
        locale={i18n.resolvedLanguage ?? "en"}
      />

      {editingLayout && (
        <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} py="xs">
          {t("dashboard.editHint")}
        </Alert>
      )}

      {/* Above the grid and outside it: the widgets are the reader's to arrange,
        but an overdue bill is not a preference. Something you can remove is
        something the one person who removes it will then miss. */}
      <NeedsAttention walletId={walletId} />

      <GridDashboard
        ref={gridApi}
        items={layout.widgets}
        editing={editingLayout}
        onChange={applyGridChange}
        sizes={WIDGET_SIZES}
        render={(item) => (
          <WidgetFrame
            editing={editingLayout}
            label={labels[item.type]}
            width={item.w}
            presets={sizePresets(item.type)}
            onResize={(w) => gridApi.current?.resizeWidget(item.id, w)}
            onRemove={() => removeWidget(item.id)}
          >
            {renderWidget(item)}
          </WidgetFrame>
        )}
      />
    </Stack>
  );
}

// The S/M/L quick-size presets, in grid columns: small ≈ third, medium ≈ half,
// large = full width — each clamped up to the widget type's minimum width (and
// never past the grid), so a preset always yields a valid size.
type SizePresets = { s: number; m: number; l: number };
function sizePresets(type: WidgetType): SizePresets {
  const { minW } = WIDGET_SIZES[type];
  const clamp = (w: number) => Math.min(Math.max(w, minW), COLUMNS);
  return { s: clamp(4), m: clamp(6), l: COLUMNS };
}

// WidgetFrame wraps a widget at its natural height (the grid cell hugs the
// content — see GridDashboard's resize observer). In edit mode it shows a header
// bar (drag affordance + S/M/L quick-size buttons + remove button); the
// interactive controls stop pointer events from starting a gridstack drag.
function WidgetFrame({
  editing,
  label,
  width,
  presets,
  onResize,
  onRemove,
  children,
}: {
  editing: boolean;
  label: string;
  width: number;
  presets: SizePresets;
  onResize: (w: number) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  // Highlight the preset the widget is currently at (none, if it's a custom width).
  const active =
    width === presets.l ? "l" : width === presets.m ? "m" : width === presets.s ? "s" : "";
  const { t } = useTranslation();
  return (
    // cb-widget flattens the card each widget renders as its root: the tile has
    // the overview as sections separated by air and a hairline, not a field of
    // boxes. Doing it here rather than in seventeen widgets keeps the widgets
    // reusable anywhere a card is still the right frame.
    <Box className="cb-widget" style={{ display: "flex", flexDirection: "column" }}>
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
            {/* Full-strength text, not dimmed: this bar sits on the hover grey,
                and dimmed text on it is 3.98:1 in dark mode. */}
            <Text size="xs" fw={600} lineClamp={1}>
              {label}
            </Text>
          </Group>
          <Group gap={4} wrap="nowrap">
            <SegmentedControl
              size="xs"
              value={active}
              onChange={(v) => onResize(presets[v as keyof SizePresets])}
              onPointerDown={(e) => e.stopPropagation()}
              data={[
                { label: t("dashboard.size.small"), value: "s" },
                { label: t("dashboard.size.medium"), value: "m" },
                { label: t("dashboard.size.large"), value: "l" },
              ]}
            />
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              // Named for what it does. Named after the widget alone, a screen
              // reader announced "Balances, button" for the control that hides it.
              aria-label={t("dashboard.hideWidgetNamed", { name: label })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onRemove}
            >
              <IconEyeOff size={14} />
            </ActionIcon>
          </Group>
        </Group>
      )}
      <Box className="cb-widget-body">{children}</Box>
    </Box>
  );
}
