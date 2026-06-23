import {
  ActionIcon,
  Box,
  Card,
  Group,
  Menu,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type CurrencyInfo,
  type DashboardAccount,
  type DashboardGroupBy,
  getDashboard,
  listAccounts,
} from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { Chart } from "../components/Chart";
import { Donut } from "../components/Donut";
import { QuickAdd } from "../components/QuickAdd";
import { formatMinor } from "../money";
import { useWallet } from "../wallet/WalletProvider";
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

// DashView is the on-the-fly spending-widget configuration the user can tweak
// from the dashboard; it is remembered in localStorage across reloads.
interface DashView {
  period: DatePreset;
  chartType: ChartType;
  groupBy: DashboardGroupBy;
}

const VIEW_KEY = "cb.dashboard.view";
const DEFAULT_VIEW: DashView = { period: "thisMonth", chartType: "donut", groupBy: "category" };
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
  const walletId = currentWallet?.id ?? 0;

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
    queryKey: ["dashboard", walletId, from, to, view.groupBy],
    queryFn: () => getDashboard(walletId, from, to, view.groupBy),
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

  return (
    <Stack>
      <Title order={2}>{t("dashboard.title")}</Title>

      {base && data && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TotalCard label={t("register.bank")} value={data.totals.bank} fmt={base} />
          <TotalCard label={t("register.today")} value={data.totals.today} fmt={base} />
          <TotalCard label={t("register.future")} value={data.totals.future} fmt={base} />
        </SimpleGrid>
      )}

      <QuickAddCard walletId={walletId} />

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
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
                </Table>
              </div>
            ))}
          </Stack>
        </Card>

        <Stack>
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
            <SpendingChart
              slices={data?.topCategories ?? []}
              base={base}
              chartType={view.chartType}
            />
          </Card>

          <Card withBorder>
            <Title order={4} mb="sm">
              {t("dashboard.upcoming")}
            </Title>
            {(data?.upcoming ?? []).length === 0 ? (
              <Text c="dimmed">{t("dashboard.noUpcoming")}</Text>
            ) : (
              <Stack gap={6}>
                {(data?.upcoming ?? []).map((u) => (
                  <Group key={u.id} justify="space-between" wrap="nowrap">
                    <Text size="sm" truncate>
                      {u.templateName}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {u.nextDue}
                    </Text>
                  </Group>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}

// QuickAddCard lets the user add a transaction to a chosen account without
// leaving the dashboard; the totals and balances refresh on add.
function QuickAddCard({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
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

  const onAdded = () => {
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
  };
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={4}>{t("dashboard.quickAdd")}</Title>
        <Select
          aria-label={t("transactions.account")}
          data={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
          value={accountId}
          onChange={setAccountId}
          allowDeselect={false}
          searchable
          w={220}
        />
      </Group>
      {account && (
        <QuickAdd walletId={walletId} account={account} onAdded={onAdded} onError={onError} />
      )}
    </Stack>
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

  return (
    <Group align="center" wrap="wrap" gap="xl">
      <Donut data={data} />
      <Stack gap={4} style={{ flex: 1, minWidth: 160 }}>
        {data.map((d) => (
          <Group key={d.label} justify="space-between" wrap="nowrap" gap="sm">
            <Group gap={6} wrap="nowrap">
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: d.color,
                  display: "inline-block",
                }}
              />
              <Text size="sm" truncate>
                {d.label}
              </Text>
            </Group>
            <Text size="sm" fw={500}>
              {formatMinor(d.value, base)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}
