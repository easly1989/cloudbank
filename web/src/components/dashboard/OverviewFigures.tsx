import { Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo, MonthPoint } from "../../api/client";
import { expenseColor, incomeColor, negativeOnlyColor } from "../../amountTone";
import { formatMinor } from "../../money";
import { periodTotals, type BalanceKey } from "./overviewFigureModel";
import { FIGURES } from "../../pages/overviewTheme";

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
    <Group
      gap={FIGURES.gap}
      wrap="wrap"
      align="flex-start"
      py={FIGURES.padY}
      style={{ width: "100%" }}
    >
      {balances.map((key, i) => (
        <Figure
          key={key}
          label={label[key]}
          // The first balance is the headline; a second or third one the reader
          // asked for sits at the same size as earned and spent.
          headline={i === 0}
          colour={negativeOnlyColor(totals[key])}
          value={formatMinor(totals[key], base)}
        />
      ))}
      <Figure
        label={t("overview.earned")}
        colour={incomeColor}
        value={`+${formatMinor(earned, base)}`}
      />
      <Figure
        label={t("overview.spent")}
        colour={expenseColor}
        value={`−${formatMinor(spent, base)}`}
      />
      <Figure
        label={t("overview.kept")}
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
  headline = false,
  colour,
}: {
  label: string;
  value: string;
  /** The one figure the page is about; everything else explains it. */
  headline?: boolean;
  colour?: string;
}) {
  const type = headline ? FIGURES.headline : FIGURES.secondary;
  return (
    // The smaller figures start six pixels down, which is what puts their
    // labels on the same line as the headline's rather than a hair above it.
    <Stack gap={FIGURES.labelGap} pt={headline ? 0 : FIGURES.secondaryOffset}>
      <Text fz={FIGURES.label.fz} c="dimmed" lh={1.2}>
        {label}
      </Text>
      <Text
        ff="monospace"
        c={colour}
        lh={1.3}
        style={{ fontSize: type.fz, fontWeight: type.fw, whiteSpace: "nowrap" }}
      >
        {value}
      </Text>
    </Stack>
  );
}
