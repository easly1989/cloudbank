import { ActionIcon, Button, Menu, SegmentedControl, Select, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDots } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type BudgetMode,
  type Category,
  type CategoryBudget,
  clearCategoryBudget,
  getBudgetHistory,
  setCategoryBudget,
} from "../../api/client";
import { SideSheet } from "../../components/SideSheet";
import { ENTRY_SHEET } from "../../components/entrySheetTheme";
import { type MoneyFormat, formatMinor } from "../../money";
import { useAmountParser } from "../../useAmountParser";
import { categoryLabel } from "../payees/payeeList";
import { type BudgetLine, historyStats, lastTwelve, type Plan, planFor } from "./budgetList";
import type { Money } from "./BudgetTable";
import classes from "./budget.module.css";

/** What the sheet opens on: a category (with its line, when it has one), or a
 *  new budget whose category is still to choose. */
export interface SheetTarget {
  categoryId?: number;
  line?: BudgetLine;
  /** A suggested monthly amount, as a magnitude. */
  amount?: number;
}

type Scope = "every" | "year";

/** A signed minor amount as a plain positive input string. */
const plain = (amount: number, fmt: MoneyFormat) =>
  amount === 0
    ? ""
    : formatMinor(Math.abs(amount), { ...fmt, groupChar: "", symbol: "", symbolPrefix: false });

/**
 * A category's budget in the sheet beside the page (#568): the plan, the same
 * every month or month by month, for every year or this one only, and the
 * last twelve months against it, with the average as a suggestion. It saves
 * with Save, not on leaving a field.
 */
export function BudgetSheet({
  opened,
  onClose,
  walletId,
  target,
  year,
  periodName,
  today,
  categories,
  every,
  thisYear,
  fmt,
  money,
  onSaved,
  onTransactions,
  onRemove,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  target: SheetTarget | null;
  /** The year of the period on the page: what "only" is about. */
  year: number;
  periodName: string;
  today: string;
  categories: Category[];
  /** The every-year budgets, and those of `year` alone. */
  every: CategoryBudget[];
  thisYear: CategoryBudget[];
  fmt: MoneyFormat;
  money: Money;
  onSaved: () => void;
  onTransactions: (categoryId: number) => void;
  onRemove: (categoryId: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const parseAmount = useAmountParser();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [mode, setMode] = useState<BudgetMode>("same");
  const [same, setSame] = useState("");
  const [monthly, setMonthly] = useState<string[]>(Array(12).fill(""));
  const [scope, setScope] = useState<Scope>("every");

  const entryOf = (id: number | null) => ({
    year: thisYear.find((b) => b.categoryId === id),
    every: every.find((b) => b.categoryId === id),
  });

  // Seeded on opening, during render, so the sheet never shows a frame of the
  // category before; the key is null while closed, so reopening starts afresh.
  const openKey = opened ? `${target?.categoryId ?? "new"}:${target?.amount ?? ""}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey !== null) {
      const id = target?.categoryId ?? null;
      const e = entryOf(id);
      const b = e.year ?? e.every;
      setCategoryId(id != null ? String(id) : null);
      setMode(b?.mode ?? "same");
      setSame(b ? plain(b.same, fmt) : target?.amount ? plain(target.amount, fmt) : "");
      setMonthly((b?.monthly ?? Array(12).fill(0)).map((v) => plain(v, fmt)));
      setScope(e.year ? "year" : "every");
    }
  }

  const id = categoryId ? Number(categoryId) : null;
  const category = categories.find((c) => c.id === id);
  const income = !!category?.isIncome;
  const existing = entryOf(id);
  const hasBudget = !!(existing.year || existing.every);

  const parse = (s: string) => parseAmount(s, fmt.fracDigits, fmt.decimalChar) ?? 0;
  const plan: Plan = { mode, same: parse(same), monthly: monthly.map(parse) };
  const empty = mode === "same" ? plan.same === 0 : plan.monthly.every((v) => v === 0);

  const history = useQuery({
    queryKey: ["budgetHistory", walletId, id],
    queryFn: () => getBudgetHistory(walletId, id!, 13),
    enabled: opened && id != null,
  });
  const months = useMemo(
    () => lastTwelve(history.data?.months ?? [], today),
    [history.data, today],
  );
  const stats = historyStats(months, income, plan, fmt.fracDigits);

  const save = useMutation({
    mutationFn: async () => {
      const sign = income ? 1 : -1;
      await setCategoryBudget(walletId, id!, {
        year: scope === "year" ? year : 0,
        mode,
        same: sign * plan.same,
        monthly: plan.monthly.map((v) => sign * v),
      });
      // Back to every year: this year's own plan would hide it.
      if (scope === "every" && existing.year) await clearCategoryBudget(walletId, id!, year);
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Switching the plan keeps the amount entered.
  const switchMode = (next: BudgetMode) => {
    if (next === mode) return;
    if (next === "monthly") setMonthly(Array(12).fill(same));
    else setSame(monthly.find((m) => m.trim() !== "") ?? "");
    setMode(next);
  };

  // A new budget picks among the categories that have none.
  const choices = useMemo(
    () =>
      categories
        .filter(
          (c) =>
            !c.noBudget &&
            !every.some((b) => b.categoryId === c.id) &&
            !thisYear.some((b) => b.categoryId === c.id),
        )
        .map((c) => ({ value: String(c.id), label: categoryLabel(c, categories) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [categories, every, thisYear],
  );

  const line = target?.line;
  const kind = income ? t("budget.sheet.income") : t("budget.sheet.spending");
  const subtitle = !category
    ? undefined
    : line?.budgeted
      ? t("budget.sheet.subtitleOf", {
          kind,
          spent: money(line.spent + line.coming),
          plan: money(line.plan),
          period: periodName,
        })
      : line && line.spent + line.coming > 0
        ? t("budget.sheet.subtitleSpent", {
            kind,
            spent: money(line.spent + line.coming),
            period: periodName,
          })
        : kind;

  const monthName = useMemo(() => {
    const f = new Intl.DateTimeFormat(i18n.language, { month: "narrow", timeZone: "UTC" });
    return (ym: string) => f.format(new Date(`${ym}-01T00:00:00Z`));
  }, [i18n.language]);
  const values = months.map((m) => (income ? 1 : -1) * m.amount);
  const plans = months.map((m) => planFor(plan, Number(m.month.slice(5, 7))));
  const top = Math.max(1, ...values, ...plans);

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="budget-sheet"
      title={category ? categoryLabel(category, categories) : t("budget.sheet.addTitle")}
      subtitle={subtitle}
      headerActions={
        hasBudget &&
        id != null && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon
                variant="default"
                size={ENTRY_SHEET.headerButton}
                aria-label={t("budget.actionsFor", { name: category?.name ?? "" })}
              >
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => onTransactions(id)}>
                {t("budget.menu.transactions")}
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={() => onRemove(id)}>
                {t("budget.menu.remove")}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )
      }
      foot={
        <>
          <Button variant="default" onClick={onClose}>
            {t("budget.sheet.cancel")}
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={id == null || empty}
          >
            {t("budget.sheet.save")}
          </Button>
        </>
      }
    >
      {target?.categoryId == null && (
        <Select
          label={t("budget.sheet.category")}
          placeholder={t("budget.sheet.pickCategory")}
          data={choices}
          value={categoryId}
          onChange={setCategoryId}
          searchable
          data-autofocus
        />
      )}
      <div>
        <Text size="sm" fw={500} mb={5} component="label" id="budget-plan">
          {t("budget.sheet.plan")}
        </Text>
        <SegmentedControl
          fullWidth
          aria-labelledby="budget-plan"
          value={mode}
          onChange={(v) => switchMode(v as BudgetMode)}
          data={[
            { value: "same", label: t("budget.sheet.same") },
            { value: "monthly", label: t("budget.sheet.monthly") },
          ]}
        />
      </div>
      {mode === "same" ? (
        <TextInput
          label={t("budget.sheet.eachMonth")}
          value={same}
          onChange={(e) => setSame(e.currentTarget.value)}
          rightSection={
            <Text size="sm" c="dimmed">
              {fmt.symbol}
            </Text>
          }
          inputMode="decimal"
          classNames={{ input: classes.mono }}
          data-autofocus={target?.categoryId != null || undefined}
        />
      ) : (
        <div className={classes.grid}>
          {monthly.map((v, i) => (
            <TextInput
              key={i}
              aria-label={t(`budget.months.${i}`)}
              leftSection={
                <Text size="xs" c="dimmed">
                  {t(`budget.months.${i}`)}
                </Text>
              }
              leftSectionWidth={40}
              value={v}
              inputMode="decimal"
              classNames={{ input: classes.mono }}
              onChange={(e) => {
                const next = e.currentTarget.value;
                setMonthly((arr) => arr.map((x, j) => (j === i ? next : x)));
              }}
            />
          ))}
        </div>
      )}
      <div>
        <Text size="sm" fw={500} mb={5} component="label" id="budget-scope">
          {t("budget.sheet.for")}
        </Text>
        <SegmentedControl
          fullWidth
          aria-labelledby="budget-scope"
          value={scope}
          onChange={(v) => setScope(v as Scope)}
          data={[
            { value: "every", label: t("budget.sheet.everyYear") },
            { value: "year", label: t("budget.sheet.yearOnly", { year }) },
          ]}
        />
      </div>
      <span className={classes.note}>{t("budget.sheet.yearNote", { year })}</span>

      {id != null && (
        <div className={classes.history} data-testid="budget-history">
          <span className={classes.historyTitle}>{t("budget.sheet.history")}</span>
          {months.length > 0 && stats.total !== 0 ? (
            <>
              <div className={classes.spark} aria-hidden>
                {months.map((m, i) => (
                  <span
                    key={m.month}
                    className={classes.col}
                    data-over={(!income && plans[i] > 0 && values[i] > plans[i]) || undefined}
                    title={`${m.month}: ${money(values[i])}`}
                  >
                    <span
                      style={{ height: `${Math.max(2, (Math.max(values[i], 0) / top) * 100)}%` }}
                    />
                    {mode === "monthly" && plans[i] > 0 && (
                      <i style={{ bottom: `${(plans[i] / top) * 100}%` }} />
                    )}
                  </span>
                ))}
                {mode === "same" && plans[0] > 0 && (
                  <i
                    className={classes.planLine}
                    style={{ bottom: `${(plans[0] / top) * 100}%` }}
                  />
                )}
              </div>
              <div className={classes.months} aria-hidden>
                {months.map((m) => (
                  <span key={m.month}>{monthName(m.month)}</span>
                ))}
              </div>
              <span className={classes.note}>
                {income
                  ? t("budget.sheet.historyNoteIncome", {
                      total: money(stats.total),
                      average: money(Math.round(stats.average)),
                    })
                  : t("budget.sheet.historyNote", {
                      total: money(stats.total),
                      average: money(Math.round(stats.average)),
                      count: stats.over,
                    })}
              </span>
              {stats.suggestion > 0 && (
                <Button
                  variant="default"
                  size="compact-sm"
                  className={classes.use}
                  onClick={() => {
                    setMode("same");
                    setSame(plain(stats.suggestion, fmt));
                  }}
                >
                  {t("budget.sheet.use", { amount: money(stats.suggestion) })}
                </Button>
              )}
            </>
          ) : (
            <span className={classes.note}>
              {history.isSuccess ? t("budget.sheet.historyNone") : " "}
            </span>
          )}
        </div>
      )}
    </SideSheet>
  );
}
