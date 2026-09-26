import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Group,
  Menu,
  SegmentedControl,
  Stack,
  Tabs,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBookmark,
  IconChevronLeft,
  IconChevronRight,
  IconDots,
  IconFileSpreadsheet,
  IconFilter,
  IconPhoto,
  IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { listCategories, listCurrencies, listPayees, listTags } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { BalancesTab } from "../components/reports/BalancesTab";
import { CashFlowTab } from "../components/reports/CashFlowTab";
import { SavedViewsModal } from "../components/reports/SavedViewsModal";
import { SpendingTab } from "../components/reports/SpendingTab";
import { VehicleTab } from "../components/reports/VehicleTab";
import {
  type ReportContext,
  type ReportExport,
  periodName,
  toCsv,
} from "../components/reports/reportContext";
import {
  PERIOD_KINDS,
  type PeriodKind,
  REPORT_TABS,
  REPORT_TRANSFERS,
  type ReportState,
  type ReportTab,
  effectivePeriod,
  isCurrentPeriod,
  parseReportState,
  periodOf,
  reportApiParams,
  reportStateToParams,
  shiftPeriod,
} from "../components/reports/reportState";
import { baseFmt } from "../components/reports/reportUtils";
import classes from "../components/reports/reports.module.css";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { RegisterFilters } from "./RegisterFilters";
import { type Filters, activeFilters } from "./registerFilterModel";

// The reports: one period bar and one set of filters for every tab, each tab
// answering its own question first (#488). Everything the page shows lives in
// the URL, so a report reloads, shares and saves exactly as it looks.
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const isPhone = useMediaQuery("(max-width: 47.99em)") ?? false;
  // Re-render at midnight, so "today" and the current period move with the day.
  const today = useToday();

  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseReportState(searchParams), [searchParams]);
  const set = useCallback(
    (patch: Partial<ReportState>) =>
      setSearchParams(reportStateToParams({ ...state, ...patch }), { replace: true }),
    [state, setSearchParams],
  );

  const kind = effectivePeriod(state);
  // Midday of the reactive today: the current period and "hide future" move
  // with it, and no timezone edge can tip it into the day before.
  const period = useMemo(
    () => periodOf(kind, state.at, new Date(`${today}T12:00:00`)),
    [kind, state.at, today],
  );
  const params = useMemo(
    () => reportApiParams(state.filters, period, new Date(`${today}T12:00:00`)),
    [state.filters, period, today],
  );

  const currencies = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const fmt = useMemo(() => baseFmt(currencies.data?.find((c) => c.isBase)), [currencies.data]);
  const payees = useQuery({ queryKey: ["payees", walletId], queryFn: () => listPayees(walletId) });
  const categories = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const tags = useQuery({ queryKey: ["tags", walletId], queryFn: () => listTags(walletId) });

  const exportRef = useRef<ReportExport | null>(null);
  const [exportable, setExportable] = useState<{ rows: boolean; png: boolean }>({
    rows: false,
    png: false,
  });
  const setExport = useCallback((e: ReportExport | null) => {
    exportRef.current = e;
    setExportable((prev) => {
      const next = { rows: !!e?.rows, png: !!e?.png };
      return prev.rows === next.rows && prev.png === next.png ? prev : next;
    });
  }, []);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);

  if (!currentWallet) return null;

  const ctx: ReportContext = {
    walletId,
    state,
    set,
    period,
    current: isCurrentPeriod(period),
    params,
    fmt,
    isPhone,
    setExport,
  };

  const download = (href: string, file: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = file;
    a.click();
  };
  const downloadCsv = () => {
    const e = exportRef.current;
    if (!e?.rows) return;
    const url = URL.createObjectURL(
      new Blob([toCsv(e.rows())], { type: "text/csv;charset=utf-8" }),
    );
    download(url, `${e.name}.csv`);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const downloadPng = () => {
    const e = exportRef.current;
    const url = e?.png?.();
    if (e && url) download(url, `${e.name}.png`);
  };

  const chips = reportChips(state.filters, t, {
    payee: payees.data?.find((p) => p.id === state.filters.payeeId)?.name,
    category: categories.data?.find((c) => c.id === state.filters.categoryId)?.name,
  });
  const setFilters = (filters: Filters) => set({ filters });

  return (
    <Stack className={classes.page}>
      <PageHeader tour="reports" title={t("reports.title")} hint={t("reports.hint")} />

      <div className={classes.bar} data-tour="reports-period">
        <SegmentedControl
          className={classes.span}
          size={isPhone ? "xs" : "sm"}
          fullWidth={isPhone}
          aria-label={t("reports.period.span")}
          value={kind}
          onChange={(v) => set({ period: v as PeriodKind, at: state.at })}
          data={PERIOD_KINDS.map((k) => ({ value: k, label: t(`reports.period.${k}`) }))}
        />
        {kind !== "all" && (
          <div className={classes.stepper}>
            <ActionIcon
              variant="default"
              size={32}
              aria-label={t("reports.period.previous")}
              onClick={() => set({ at: shiftPeriod(kind, state.at, -1) })}
            >
              <IconChevronLeft size={16} />
            </ActionIcon>
            <span className={classes.stepLabel} aria-live="polite" data-testid="report-period">
              {periodName(period, t, i18n.language)}
            </span>
            <ActionIcon
              variant="default"
              size={32}
              aria-label={t("reports.period.next")}
              onClick={() => set({ at: shiftPeriod(kind, state.at, 1) })}
            >
              <IconChevronRight size={16} />
            </ActionIcon>
          </div>
        )}
        <span className={classes.spacer} />
        <Button
          variant="default"
          leftSection={<IconFilter size={16} />}
          rightSection={
            chips.length > 0 ? (
              <Badge size="sm" circle>
                {chips.length}
              </Badge>
            ) : undefined
          }
          onClick={() => setFiltersOpen(true)}
        >
          {t("reports.filters")}
        </Button>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="default"
              size={36}
              aria-label={t("reports.more")}
              data-tour="reports-more"
            >
              <IconDots size={18} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconBookmark size={16} />} onClick={() => setViewsOpen(true)}>
              {t("reports.views.menu")}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<IconFileSpreadsheet size={16} />}
              disabled={!exportable.rows}
              onClick={downloadCsv}
            >
              {t("reports.exportCsv")}
            </Menu.Item>
            <Menu.Item
              leftSection={<IconPhoto size={16} />}
              disabled={!exportable.png}
              onClick={downloadPng}
            >
              {t("reports.exportPng")}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </div>

      {chips.length > 0 && (
        <Group gap={6} wrap="wrap">
          {chips.map((c) => (
            <Badge
              key={c.id}
              variant="light"
              size="lg"
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color="gray"
                  aria-label={t("filters.chip.remove", { name: c.label })}
                  onClick={() => setFilters(c.clear(state.filters))}
                >
                  <IconX size={12} />
                </ActionIcon>
              }
            >
              {c.label}
            </Badge>
          ))}
        </Group>
      )}

      <Tabs
        value={state.tab}
        onChange={(v) => v && set({ tab: v as ReportTab })}
        keepMounted={false}
      >
        <Tabs.List data-tour="reports-tabs" className={classes.tabList}>
          {REPORT_TABS.map((tab) => (
            <Tabs.Tab key={tab} value={tab}>
              {t(`reports.tabs.${tab}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="spending" pt="lg">
          <SpendingTab ctx={ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="cashflow" pt="lg">
          <CashFlowTab ctx={ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="balances" pt="lg">
          <BalancesTab ctx={ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="vehicle" pt="lg">
          <VehicleTab ctx={ctx} />
        </Tabs.Panel>
      </Tabs>

      <Drawer
        opened={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        position={isPhone ? "bottom" : "right"}
        size={isPhone ? "85%" : 380}
        title={t("reports.filters")}
      >
        <RegisterFilters
          filters={state.filters}
          onChange={setFilters}
          payees={payees.data ?? []}
          categories={categories.data ?? []}
          tags={tags.data ?? []}
          fmt={fmt}
          dates={false}
        />
      </Drawer>

      <SavedViewsModal
        opened={viewsOpen}
        onClose={() => setViewsOpen(false)}
        walletId={walletId}
        search={searchParams.toString()}
        onOpen={(search) => {
          setSearchParams(new URLSearchParams(search), { replace: true });
          setViewsOpen(false);
        }}
      />
    </Stack>
  );
}

interface ReportChip {
  id: string;
  label: string;
  clear: (f: Filters) => Filters;
}

// The register's chips, told the reports' two differences: the period bar owns
// the dates, and leaving transfers out is the default, so only including them
// needs a chip.
function reportChips(
  f: Filters,
  t: (k: string) => string,
  names: { payee?: string; category?: string },
): ReportChip[] {
  const out: ReportChip[] = [];
  for (const c of activeFilters(f)) {
    if (c.id === "preset") continue;
    if (c.id === "transfers") {
      if (f.transfers === REPORT_TRANSFERS) continue;
      out.push({
        id: c.id,
        label: t(`reports.chip.transfers.${f.transfers}`),
        clear: (x) => ({ ...x, transfers: REPORT_TRANSFERS }),
      });
      continue;
    }
    const value =
      c.value ??
      (c.id === "payee" ? names.payee : c.id === "category" ? names.category : undefined);
    out.push({
      id: c.id,
      label: value ? `${t(c.labelKey)}: ${value}` : t(c.labelKey),
      clear: c.clear,
    });
  }
  // "transfers: all" is not a register facet: activeFilters leaves it out.
  if (f.transfers === "all" && !out.some((c) => c.id === "transfers")) {
    out.push({
      id: "transfers",
      label: t("reports.chip.transfers.all"),
      clear: (x) => ({ ...x, transfers: REPORT_TRANSFERS }),
    });
  }
  return out;
}
