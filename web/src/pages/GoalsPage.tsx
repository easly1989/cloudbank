import { Button, Stack } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  closeGoal,
  deleteGoal,
  getDashboard,
  listAccounts,
  listCurrencies,
  listGoalContributions,
  listGoals,
  reopenGoal,
} from "../api/client";
import { useConfirm } from "../components/confirmContext";
import { PageHeader } from "../components/PageHeader";
import { baseFmt } from "../components/reports/reportUtils";
import { formatMinor } from "../money";
import { useToday } from "../useToday";
import { useWallet } from "../wallet/WalletProvider";
import { type GoalLine, monthIndex, monthStart, percentOf, viewOf } from "./goals/goalList";
import classes from "./goals/goals.module.css";
import { type GoalPreset, GoalSheet } from "./goals/GoalSheet";
import {
  type GoalExample,
  GoalsEmpty,
  GoalsPhoneList,
  GoalsTable,
  Figures,
} from "./goals/GoalsTable";
import type { GoalActions } from "./goals/goalWords";
import { type Direction, MoneySheet } from "./goals/MoneySheet";

/**
 * Savings goals (#572): what is set aside, what a month gets every goal there
 * by its date, and what is left free to spend; then a row per goal, reached
 * ones waiting to be closed, and the history of the closed ones, folded away.
 * Goals are notes about money, not money: nothing here moves a balance.
 */
export function GoalsPage() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const today = useToday();

  const currencies = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const fmt = useMemo(() => baseFmt(currencies.data?.find((c) => c.isBase)), [currencies.data]);
  const money = (minor: number) => formatMinor(minor, fmt);

  const goalsQuery = useQuery({
    queryKey: ["goals", walletId],
    queryFn: () => listGoals(walletId),
    enabled: walletId > 0,
  });
  const goals = useMemo(() => goalsQuery.data ?? [], [goalsQuery.data]);
  const accountsQuery = useQuery({
    queryKey: ["accounts", walletId],
    queryFn: () => listAccounts(walletId),
    enabled: walletId > 0,
  });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  // The same query the sidebar runs for the wallet's balance.
  const summary = useQuery({
    queryKey: ["dashboard", walletId, "0001-01-01", "9999-12-31", "category", 12],
    queryFn: () => getDashboard(walletId, "0001-01-01", "9999-12-31", "category", 12),
    enabled: walletId > 0,
  });

  // The pace needs each goal's movements; closed goals need none.
  const live = goals.filter((g) => g.closedOn == null);
  const movesQueries = useQueries({
    queries: live.map((g) => ({
      queryKey: ["goalContributions", walletId, g.id],
      queryFn: () => listGoalContributions(walletId, g.id),
      enabled: walletId > 0,
    })),
  });
  const moves = new Map(live.map((g, i) => [g.id, movesQueries[i]?.data ?? []]));
  const view = viewOf(goals, moves, today, fmt.fracDigits);
  const lineById = (id: number | null) =>
    id == null
      ? null
      : ([...view.open, ...view.reached, ...view.history].find((l) => l.id === id) ?? null);

  const [historyOpen, setHistoryOpen] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["goals", walletId] });
    void qc.invalidateQueries({ queryKey: ["goalContributions", walletId] });
  };
  const showError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  // The goal's sheet, and the sheet for money in and out. Each keeps the goal
  // it opened on, so it can close without losing its content.
  const [goalSheet, setGoalSheet] = useState<{
    open: boolean;
    id: number | null;
    preset: GoalPreset | null;
  }>({ open: false, id: null, preset: null });
  const [moneySheet, setMoneySheet] = useState<{
    open: boolean;
    id: number | null;
    direction: Direction;
  }>({ open: false, id: null, direction: "in" });
  const openGoal = (id: number | null, preset: GoalPreset | null = null) =>
    setGoalSheet({ open: true, id, preset });
  const openMoney = (id: number, direction: Direction) =>
    setMoneySheet({ open: true, id, direction });
  const closeSheets = () => {
    setGoalSheet((s) => ({ ...s, open: false }));
    setMoneySheet((s) => ({ ...s, open: false }));
  };

  const close = useMutation({
    mutationFn: (id: number) => closeGoal(walletId, id, today),
    onSuccess: invalidate,
    onError: showError,
  });
  const reopen = useMutation({
    mutationFn: (id: number) => reopenGoal(walletId, id),
    onSuccess: invalidate,
    onError: showError,
  });
  const remove = useMutation({
    mutationFn: (id: number) => deleteGoal(walletId, id),
    onSuccess: invalidate,
    onError: showError,
  });

  const askClose = async (l: GoalLine) => {
    const ok = await confirm({
      title: t("goals.confirmCloseTitle", { name: l.name }),
      body: t("goals.confirmCloseBody", { saved: money(l.saved), target: money(l.targetAmount) }),
      confirmLabel: t("goals.confirmClose"),
    });
    if (ok) {
      closeSheets();
      close.mutate(l.id);
    }
  };
  const askGiveUp = async (l: GoalLine) => {
    const ok = await confirm({
      title: t("goals.confirmGiveUpTitle", { name: l.name }),
      body: t("goals.confirmGiveUpBody", {
        saved: money(l.saved),
        target: money(l.targetAmount),
        percent: percentOf(l),
      }),
      confirmLabel: t("goals.confirmGiveUp"),
    });
    if (ok) {
      closeSheets();
      close.mutate(l.id);
    }
  };
  const askDelete = async (l: GoalLine) => {
    const ok = await confirm({
      title: t("goals.confirmDeleteTitle", { name: l.name }),
      body: t("goals.confirmDeleteBody"),
      confirmLabel: t("goals.menu.delete"),
      danger: true,
    });
    if (ok) {
      closeSheets();
      remove.mutate(l.id);
    }
  };

  const actions: GoalActions = {
    onOpen: (l) => openGoal(l.id),
    onPutIn: (l) => openMoney(l.id, "in"),
    onTakeOut: (l) => openMoney(l.id, "out"),
    onClose: (l) => void askClose(l),
    onGiveUp: (l) => void askGiveUp(l),
    onReopen: (l) => reopen.mutate(l.id),
    onDelete: (l) => void askDelete(l),
  };

  // Empty: three goals to start from, dated where a date makes sense.
  const examples = useMemo((): GoalExample[] => {
    const unit = 10 ** fmt.fracDigits;
    const now = monthIndex(today);
    const next = (m: number) => {
      const year = Math.floor(now / 12);
      const i = year * 12 + m;
      return i > now ? i : i + 12;
    };
    const june = next(5);
    const spring = next(2);
    const trip = 1800 * unit;
    const bike = 600 * unit;
    return [
      {
        key: "trip",
        sub: t("goals.empty.tripSub", {
          amount: money(trip),
          monthly: money(Math.ceil(trip / Math.max(1, june - now) / unit) * unit),
        }),
        onUse: () =>
          openGoal(null, {
            name: t("goals.empty.trip"),
            targetAmount: trip,
            targetDate: monthStart(june),
          }),
      },
      {
        key: "fund",
        sub: t("goals.empty.fundSub"),
        onUse: () => openGoal(null, { name: t("goals.empty.fund") }),
      },
      {
        key: "bike",
        sub: t("goals.empty.bikeSub", { amount: money(bike) }),
        onUse: () =>
          openGoal(null, {
            name: t("goals.empty.bike"),
            targetAmount: bike,
            targetDate: monthStart(spring),
          }),
      },
    ];
    // money follows fmt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fmt, today, t]);

  if (!currentWallet) return null;

  const empty = goalsQuery.isSuccess && goals.length === 0;
  const listProps = {
    view,
    money,
    today,
    accountName: (id: number) => accounts.find((a) => a.id === id)?.name,
    historyOpen,
    onToggleHistory: () => setHistoryOpen((v) => !v),
    actions,
  };

  return (
    <Stack className={classes.page} gap="md">
      <PageHeader
        tour="goals"
        title={t("goals.title")}
        hint={t("goals.hint")}
        actions={
          !empty && (
            <Button onClick={() => openGoal(null)} data-tour="goals-add">
              {t("goals.add")}
            </Button>
          )
        }
      />

      {empty ? (
        <GoalsEmpty examples={examples} onAdd={() => openGoal(null)} />
      ) : (
        goals.length > 0 && (
          <>
            <Figures view={view} wallet={summary.data?.totals.today ?? null} money={money} />
            {phone ? (
              <GoalsPhoneList {...listProps} />
            ) : (
              <>
                <GoalsTable {...listProps} />
                <span className={classes.line}>{t("goals.line")}</span>
              </>
            )}
          </>
        )
      )}

      <GoalSheet
        opened={goalSheet.open}
        onClose={() => setGoalSheet((s) => ({ ...s, open: false }))}
        walletId={walletId}
        goal={lineById(goalSheet.id)}
        preset={goalSheet.preset}
        accounts={accounts}
        fmt={fmt}
        money={money}
        today={today}
        onSaved={invalidate}
        actions={actions}
      />
      <MoneySheet
        opened={moneySheet.open}
        onClose={() => setMoneySheet((s) => ({ ...s, open: false }))}
        walletId={walletId}
        goal={lineById(moneySheet.id)}
        direction={moneySheet.direction}
        fmt={fmt}
        money={money}
        today={today}
        onSaved={invalidate}
      />
    </Stack>
  );
}
