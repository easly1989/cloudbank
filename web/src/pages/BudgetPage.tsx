import {
  Button,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  type BudgetMode,
  type Category,
  type CategoryBudget,
  clearCategoryBudget,
  getBudgetReport,
  listBudgets,
  listCategories,
  listCurrencies,
  setCategoryBudget,
} from "../api/client";
import { BudgetGauge } from "../components/BudgetGauge";
import { type MoneyFormat, formatMinor } from "../money";
import { rowFocusProps } from "../rowEdit";
import { useAmountParser } from "../useAmountParser";
import { useWallet } from "../wallet/WalletProvider";

export function BudgetPage() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;

  const currenciesQuery = useQuery({
    queryKey: ["currencies", walletId],
    queryFn: () => listCurrencies(walletId),
    enabled: walletId > 0,
  });
  const base = (currenciesQuery.data ?? []).find((c) => c.isBase);
  const fmt: MoneyFormat = base
    ? {
        fracDigits: base.fracDigits,
        decimalChar: base.decimalChar,
        groupChar: base.groupChar,
        symbol: base.symbol,
        symbolPrefix: base.symbolPrefix,
      }
    : { fracDigits: 2, decimalChar: ".", groupChar: ",", symbol: "", symbolPrefix: false };

  if (!currentWallet) return null;

  return (
    <Stack>
      <Title order={2}>{t("budget.title")}</Title>
      <Tabs defaultValue="editor">
        <Tabs.List>
          <Tabs.Tab value="editor">{t("budget.editor")}</Tabs.Tab>
          <Tabs.Tab value="report">{t("budget.report")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="editor" pt="md">
          <BudgetEditor walletId={walletId} fmt={fmt} />
        </Tabs.Panel>
        <Tabs.Panel value="report" pt="md">
          <BudgetReportView walletId={walletId} fmt={fmt} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function BudgetEditor({ walletId, fmt }: { walletId: number; fmt: MoneyFormat }) {
  const { t } = useTranslation();
  const [year, setYear] = useState(0);
  const categoriesQuery = useQuery({
    queryKey: ["categories", walletId],
    queryFn: () => listCategories(walletId),
  });
  const budgetsQuery = useQuery({
    queryKey: ["budgets", walletId, year],
    queryFn: () => listBudgets(walletId, year),
  });

  const budgetByCat = useMemo(() => {
    const m = new Map<number, CategoryBudget>();
    for (const b of budgetsQuery.data ?? []) m.set(b.categoryId, b);
    return m;
  }, [budgetsQuery.data]);

  const categories = (categoriesQuery.data ?? []).filter((c) => !c.noBudget);

  // "Every year" (0) plus a small window of calendar years around now.
  const thisYear = new Date().getFullYear();
  const yearOptions = [
    { value: "0", label: t("budget.everyYear") },
    ...Array.from({ length: 5 }, (_, i) => thisYear - 1 + i).map((y) => ({
      value: String(y),
      label: String(y),
    })),
  ];

  if (categories.length === 0) {
    return <Text c="dimmed">{t("budget.noCategories")}</Text>;
  }

  return (
    <Stack>
      <Group>
        <Select
          label={t("budget.year")}
          data={yearOptions}
          value={String(year)}
          onChange={(v) => setYear(Number(v ?? 0))}
          allowDeselect={false}
          w={160}
        />
        {year !== 0 && (
          <Text size="sm" c="dimmed" mt={24}>
            {t("budget.yearHint")}
          </Text>
        )}
      </Group>
      <Table.ScrollContainer minWidth={480}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("budget.category")}</Table.Th>
              <Table.Th>{t("budget.mode")}</Table.Th>
              <Table.Th>{t("budget.amounts")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {categories.map((cat) => (
              <BudgetRow
                key={`${cat.id}-${year}`}
                walletId={walletId}
                category={cat}
                year={year}
                existing={budgetByCat.get(cat.id)}
                fmt={fmt}
              />
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function BudgetRow({
  walletId,
  category,
  year,
  existing,
  fmt,
}: {
  walletId: number;
  category: Category;
  year: number;
  existing?: CategoryBudget;
  fmt: MoneyFormat;
}) {
  const { t } = useTranslation();
  const parseAmount = useAmountParser();
  const qc = useQueryClient();
  const sign = category.isIncome ? 1 : -1;
  const toInput = (v: number) => (v === 0 ? "" : magnitude(v, fmt));

  const [mode, setMode] = useState<BudgetMode>(existing?.mode ?? "same");
  const [same, setSame] = useState<string>(toInput(existing?.same ?? 0));
  const [monthly, setMonthly] = useState<string[]>(
    (existing?.monthly ?? Array(12).fill(0)).map(toInput),
  );

  useEffect(() => {
    setMode(existing?.mode ?? "same");
    setSame(toInput(existing?.same ?? 0));
    setMonthly((existing?.monthly ?? Array(12).fill(0)).map(toInput));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing]);

  const save = useMutation({
    mutationFn: () => {
      const parse = (s: string) => (parseAmount(s, fmt.fracDigits, fmt.decimalChar) ?? 0) * sign;
      const sameVal = parse(same);
      const monthlyVals = monthly.map(parse);
      const empty = mode === "same" ? sameVal === 0 : monthlyVals.every((v) => v === 0);
      if (empty) return clearCategoryBudget(walletId, category.id, year);
      return setCategoryBudget(walletId, category.id, {
        year,
        mode,
        same: sameVal,
        monthly: monthlyVals,
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["budgets", walletId] }),
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  // Switching mode preserves the entered amount.
  const switchMode = (next: BudgetMode) => {
    if (next === mode) return;
    if (next === "monthly") {
      setMonthly(Array(12).fill(same));
    } else {
      setSame(monthly.find((m) => m.trim() !== "") ?? "");
    }
    setMode(next);
  };

  return (
    <Table.Tr {...rowFocusProps()}>
      <Table.Td>{category.parentId ? `› ${category.name}` : category.name}</Table.Td>
      <Table.Td>
        <SegmentedControl
          size="xs"
          value={mode}
          onChange={(v) => switchMode(v as BudgetMode)}
          data={[
            { value: "same", label: t("budget.same") },
            { value: "monthly", label: t("budget.monthly") },
          ]}
        />
      </Table.Td>
      <Table.Td>
        {mode === "same" ? (
          <TextInput
            size="xs"
            w={120}
            value={same}
            onChange={(e) => setSame(e.currentTarget.value)}
            onBlur={() => save.mutate()}
            rightSection={<Text size="xs">{fmt.symbol}</Text>}
          />
        ) : (
          <Group gap={4} wrap="wrap">
            {monthly.map((v, i) => (
              <TextInput
                key={i}
                size="xs"
                w={68}
                placeholder={t(`budget.months.${i}`)}
                aria-label={t(`budget.months.${i}`)}
                value={v}
                onChange={(e) =>
                  setMonthly((arr) => arr.map((x, j) => (j === i ? e.currentTarget.value : x)))
                }
                onBlur={() => save.mutate()}
              />
            ))}
          </Group>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function BudgetReportView({ walletId, fmt }: { walletId: number; fmt: MoneyFormat }) {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [rollup, setRollup] = useState(true);

  const query = useQuery({
    queryKey: ["budgetReport", walletId, from, to, rollup],
    queryFn: () => getBudgetReport(walletId, from, to, rollup),
    enabled: walletId > 0 && !!from && !!to,
  });
  const report = query.data;

  // Combined expense budget vs actual (magnitudes) for the over/under gauge.
  const expense = useMemo(() => {
    let budget = 0;
    let actual = 0;
    for (const r of report?.rows ?? []) {
      if (r.isIncome) continue;
      budget += Math.abs(r.budget);
      actual += Math.abs(r.actual);
    }
    return { budget, actual };
  }, [report]);

  const exportCsv = () => {
    if (!report) return;
    const head = ["Category", "Budget", "Actual", "Difference"];
    const lines = report.rows.map((r) =>
      [
        r.name,
        minorToPlain(r.budget, fmt),
        minorToPlain(r.actual, fmt),
        minorToPlain(r.actual - r.budget, fmt),
      ].join(","),
    );
    const csv = [head.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `budget-${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Stack>
      <Group align="flex-end">
        <TextInput
          type="date"
          label={t("budget.from")}
          value={from}
          onChange={(e) => setFrom(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label={t("budget.to")}
          value={to}
          onChange={(e) => setTo(e.currentTarget.value)}
        />
        <Switch
          label={t("budget.rollup")}
          checked={rollup}
          onChange={(e) => setRollup(e.currentTarget.checked)}
        />
        <Button
          variant="default"
          onClick={exportCsv}
          disabled={!report || report.rows.length === 0}
        >
          {t("budget.exportCsv")}
        </Button>
      </Group>

      {expense.budget > 0 && (
        <BudgetGauge budget={expense.budget} actual={expense.actual} base={fmt} />
      )}

      {report && report.rows.length === 0 && <Text c="dimmed">{t("budget.empty")}</Text>}

      {report && report.rows.length > 0 && (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("budget.category")}</Table.Th>
              <Table.Th ta="right">{t("budget.budgeted")}</Table.Th>
              <Table.Th ta="right">{t("budget.actual")}</Table.Th>
              <Table.Th ta="right">{t("budget.difference")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {report.rows.map((r) => {
              const over = r.actual < r.budget; // worse than planned (both signs)
              return (
                <Table.Tr key={r.categoryId}>
                  <Table.Td>{r.name}</Table.Td>
                  <Table.Td ta="right">{formatMinor(r.budget, fmt)}</Table.Td>
                  <Table.Td ta="right" c={over ? "red" : "teal"}>
                    {formatMinor(r.actual, fmt)}
                  </Table.Td>
                  <Table.Td ta="right" c={over ? "red" : "teal"}>
                    {formatMinor(r.actual - r.budget, fmt)}
                  </Table.Td>
                </Table.Tr>
              );
            })}
            <Table.Tr fw={700}>
              <Table.Td>{t("budget.total")}</Table.Td>
              <Table.Td ta="right">{formatMinor(report.totalBudget, fmt)}</Table.Td>
              <Table.Td ta="right">{formatMinor(report.totalActual, fmt)}</Table.Td>
              <Table.Td ta="right">
                {formatMinor(report.totalActual - report.totalBudget, fmt)}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

// magnitude formats a signed minor amount as a plain positive input string.
function magnitude(amount: number, fmt: MoneyFormat): string {
  return minorToPlain(Math.abs(amount), fmt);
}

function minorToPlain(amount: number, fmt: MoneyFormat): string {
  return formatMinor(amount, { ...fmt, groupChar: "", symbol: "", symbolPrefix: false });
}
