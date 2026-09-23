import { Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo, MonthPoint } from "../../api/client";
import { expenseColor, incomeColor, negativeOnlyColor } from "../../amountTone";
import { formatMinor } from "../../money";
import { periodTotals, type BalanceKey } from "./overviewFigureModel";

/**
 * The figures at the head of the overview: what you have, and what the period
 * did to it.
 *
 * The balance is the loudest thing on the page because it is the thing people
 * open the app to read. Earned and spent sit beside it at half its size: they
 * explain the balance rather than compete with it.
 */
export function OverviewFigures({
  balances,
  totals,
  base,
  points,
  locale,
}: {
  balances: BalanceKey[];
  totals?: { bank: number; today: number; future: number };
  base?: CurrencyInfo;
  points: readonly MonthPoint[];
  locale: string;
}) {
  const { t } = useTranslation();
  if (!base || !totals) return null;
  const { earned, spent, kept } = periodTotals(points);
  const label: Record<BalanceKey, string> = {
    bank: t("register.bank"),
    today: t("overview.balanceToday"),
    future: t("register.future"),
  };

  return (
    <Group gap={48} wrap="wrap" align="flex-end">
      {balances.map((key, i) => (
        <Figure
          key={key}
          label={label[key]}
          // The first balance is the headline; a second or third one the reader
          // asked for sits at the same size as earned and spent.
          size={i === 0 ? 40 : 24}
          weight={i === 0 ? 600 : 500}
          colour={negativeOnlyColor(totals[key])}
          value={formatMinor(totals[key], base)}
        />
      ))}
      <Figure
        label={t("overview.earned")}
        size={24}
        weight={500}
        colour={incomeColor}
        value={`+${formatMinor(earned, base)}`}
      />
      <Figure
        label={t("overview.spent")}
        size={24}
        weight={500}
        colour={expenseColor}
        value={`−${formatMinor(spent, base)}`}
      />
      <Figure
        label={t("overview.kept")}
        size={24}
        weight={500}
        value={
          kept == null
            ? "—"
            : `${kept.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
        }
      />
    </Group>
  );
}

function Figure({
  label,
  value,
  size,
  weight,
  colour,
}: {
  label: string;
  value: string;
  size: number;
  weight: number;
  colour?: string;
}) {
  return (
    <Stack gap={2}>
      <Text size="sm" c="dimmed" lh={1.2}>
        {label}
      </Text>
      <Text
        ff="monospace"
        c={colour}
        lh={1.1}
        style={{ fontSize: size, fontWeight: weight, whiteSpace: "nowrap" }}
      >
        {value}
      </Text>
    </Stack>
  );
}
