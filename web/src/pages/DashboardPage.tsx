import { ActionIcon, Box, Button, Group, Menu, Stack, Text, Title } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconEyeOff,
  IconGripVertical,
  IconPlus,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type DashboardAccount, type User, getDashboard, updateMe } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
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
import { AccountBalanceCard } from "../components/dashboard/widgets/AccountBalanceCard";
import { AccountsPanel } from "../components/dashboard/widgets/AccountsPanel";
import { BudgetWidget } from "../components/dashboard/widgets/BudgetWidget";
import { BalanceSparklineCard } from "../components/dashboard/widgets/BalanceSparklineCard";
import { CategoryBudgetCard } from "../components/dashboard/widgets/CategoryBudgetCard";
import { CurrencyRatesCard } from "../components/dashboard/widgets/CurrencyRatesCard";
import { NetWorthTrendCard } from "../components/dashboard/widgets/NetWorthTrendCard";
import { SpendingHeatmapCard } from "../components/dashboard/widgets/SpendingHeatmapCard";
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
  type IEConfig,
  type KpiConfig,
  type SpendingConfig,
} from "../components/dashboard/widgets/shared";
import { SpendingCard } from "../components/dashboard/widgets/SpendingCard";
import { TotalsWidget } from "../components/dashboard/widgets/TotalsWidget";
import { UpcomingPanel } from "../components/dashboard/widgets/UpcomingPanel";
import { useWallet } from "../wallet/WalletProvider";

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
