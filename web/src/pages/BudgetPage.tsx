import { Button, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  clearCategoryBudget,
  getBudgetReport,
  listBudgets,
  listCategories,
  listCurrencies,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { PageHeader } from "../components/PageHeader";
import { baseFmt } from "../components/reports/reportUtils";
import { formatMinor } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import {
  type BudgetLine,
  daysLeft,
  leftOf,
  paceOf,
  pathOf,
  type Period,
  periodAt,
  periodOf,
  shiftPeriod,
  viewOf,
} from "./budget/budgetList";
import classes from "./budget/budget.module.css";
import { BudgetSheet, type SheetTarget } from "./budget/BudgetSheet";
import {
  type BudgetActions,
  BudgetEmpty,
  BudgetPhoneList,
  BudgetTable,
  Figures,
  PeriodBar,
} from "./budget/BudgetTable";

/**
 * Budget (#568): the answer first — how much of the month's plan is gone and
 * how much is left — then every budget line, with what is entered but still to
 * come apart and the spending that has no budget beside it, not over anything.
 * A parent's budget covers its subcategories without one of their own. Plans
 * are edited in the sheet beside the page.
 */
export function BudgetPage() {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();

  const [period, setPeriod] = useState<Period>(() => periodAt("month", today));

  const currencies = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const fmt = useMemo(() => baseFmt(currencies.data?.find((c) => c.isBase)), [currencies.data]);
  const money = (minor: number) => formatMinor(minor, fmt);

  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
    enabled: walletId > 0,
  });
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  const everyQuery = useQuery({
    queryKey: ["budgets", walletId, 0],
    queryFn: () => listBudgets(walletId, 0),
    enabled: walletId > 0,
  });
  const yearQuery = useQuery({
    queryKey: ["budgets", walletId, period.year],
    queryFn: () => listBudgets(walletId, period.year),
    enabled: walletId > 0,
  });
  const every = useMemo(() => everyQuery.data ?? [], [everyQuery.data]);
  const thisYear = useMemo(() => yearQuery.data ?? [], [yearQuery.data]);
  const noBudgets =
    everyQuery.isSuccess && yearQuery.isSuccess && every.length === 0 && thisYear.length === 0;

  const report = useQuery({
    queryKey: ["budgetReport", walletId, period.from, period.to],
    queryFn: () => getBudgetReport(walletId, period.from, period.to),
    enabled: walletId > 0,
  });
  const view = useMemo(() => viewOf(report.data, categories), [report.data, categories]);
  const pace = paceOf(period, report.data?.today ?? today);
  const days = daysLeft(period, today);

  // Empty: where the money went over the last twelve complete months.
  const lastYear = useMemo(() => {
    const end = shiftPeriod(periodAt("month", today), -1);
    return { from: shiftPeriod(end, -11).from, to: end.to };
  }, [today]);
  const pastReport = useQuery({
    queryKey: ["budgetReport", walletId, lastYear.from, lastYear.to],
    queryFn: () => getBudgetReport(walletId, lastYear.from, lastYear.to),
    enabled: walletId > 0 && noBudgets,
  });
  const suggestions = useMemo(() => {
    const five = 5 * 10 ** fmt.fracDigits;
    return viewOf(pastReport.data, categories)
      .loose.slice(0, 4)
      .map((line) => ({ line, monthly: Math.round(line.spent / 12 / five) * five }))
      .filter((s) => s.monthly > 0);
  }, [pastReport.data, categories, fmt.fracDigits]);

  // The categories whose plan in this period's year changes month by month.
  const monthly = useMemo(() => {
    const s = new Set<number>();
    for (const b of every) if (b.mode === "monthly") s.add(b.categoryId);
    for (const b of thisYear)
      if (b.mode === "monthly") s.add(b.categoryId);
      else s.delete(b.categoryId);
    return s;
  }, [every, thisYear]);

  const periodName = useMemo(() => {
    if (period.kind === "year") return String(period.year);
    // A phone has room for "Sep 2026" beside the arrows, not "September".
    const s = new Intl.DateTimeFormat(i18n.language, {
      month: phone ? "short" : "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [period, i18n.language, phone]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["budgets", walletId] });
    void qc.invalidateQueries({ queryKey: ["budgetReport", walletId] });
    void qc.invalidateQueries({ queryKey: ["budgetHistory", walletId] });
  };

  const [sheetOpen, setSheetOpen] = useState(false);
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const open = (next: SheetTarget | null) => {
    setTarget(next);
    setSheetOpen(true);
  };

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await clearCategoryBudget(walletId, id, 0);
      if (thisYear.some((b) => b.categoryId === id))
        await clearCategoryBudget(walletId, id, period.year);
    },
    onSuccess: invalidate,
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const transactions = (id: number) => {
    const income = categories.find((c) => c.id === id)?.isIncome;
    navigate(`/reports?cat=${id}&p=${period.kind}&at=${period.from}${income ? "&ty=income" : ""}`);
  };
  const removeBudget = async (id: number) => {
    setSheetOpen(false);
    const c = categories.find((x) => x.id === id);
    const ok = await confirm({
      title: t("budget.confirmRemoveTitle", { name: c?.name ?? "" }),
      body: t("budget.confirmRemoveBody"),
      confirmLabel: t("budget.menu.remove"),
      danger: true,
    });
    if (ok) remove.mutate(id);
  };

  const actions: BudgetActions = {
    onEdit: (l) => open({ categoryId: l.id, line: l }),
    onTransactions: (l) => transactions(l.id),
    onRemove: (l) => void removeBudget(l.id),
  };

  const exportCsv = () => {
    const plain = (v: number) =>
      formatMinor(v, { ...fmt, groupChar: "", symbol: "", symbolPrefix: false });
    const cell = (s: string) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [...view.spending, ...view.loose, ...view.income].map((l: BudgetLine) =>
      [
        pathOf(l),
        l.budgeted ? plain(l.plan) : "",
        plain(l.spent),
        plain(l.coming),
        l.budgeted ? plain(leftOf(l)) : "",
      ]
        .map(cell)
        .join(","),
    );
    const head = [
      t("budget.col.category"),
      t("budget.col.planned"),
      t("budget.col.spent"),
      t("budget.col.coming"),
      t("budget.col.left"),
    ]
      .map(cell)
      .join(",");
    const blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-${period.from}_${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!currentWallet) return null;

  const periodBar = (
    <PeriodBar
      period={period}
      name={periodName}
      phone={phone}
      onKind={(k) => setPeriod(periodOf(k, period.year, period.month))}
      onShift={(d) => setPeriod(shiftPeriod(period, d))}
      onExport={exportCsv}
    />
  );

  return (
    <Stack className={classes.page} gap="md">
      <PageHeader
        tour="budget"
        title={t("budget.title")}
        hint={t("budget.hint")}
        actions={
          !noBudgets && (
            <Button onClick={() => open(null)} data-tour="budget-add">
              {t("budget.add")}
            </Button>
          )
        }
      />

      {noBudgets ? (
        <BudgetEmpty
          suggestions={suggestions}
          money={money}
          onAdd={(l, amount) => open(l ? { categoryId: l.id, amount } : null)}
        />
      ) : (
        <>
          {phone && periodBar}
          <Figures
            view={view}
            pace={pace}
            days={days}
            money={money}
            period={phone ? undefined : periodBar}
          />
          {phone ? (
            <BudgetPhoneList view={view} pace={pace} money={money} actions={actions} />
          ) : (
            <>
              <BudgetTable
                view={view}
                pace={pace}
                money={money}
                monthly={monthly}
                actions={actions}
              />
              <span className={classes.line}>
                {period.kind === "year" ? t("budget.lineYear") : t("budget.lineMonth")}
              </span>
            </>
          )}
        </>
      )}

      <BudgetSheet
        opened={sheetOpen}
        onClose={() => setSheetOpen(false)}
        walletId={walletId}
        target={target}
        year={period.year}
        periodName={periodName}
        today={today}
        categories={categories}
        every={every}
        thisYear={thisYear}
        fmt={fmt}
        money={money}
        onSaved={invalidate}
        onTransactions={transactions}
        onRemove={(id) => void removeBudget(id)}
      />
    </Stack>
  );
}
