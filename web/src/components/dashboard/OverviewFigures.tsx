import { Group, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";

import type { CurrencyInfo, MonthPoint } from "../../api/client";
import { expenseColor, incomeColor, negativeOnlyColor } from "../../amountTone";
import { formatMinor } from "../../money";
import { periodTotals, type BalanceKey } from "./overviewFigureModel";
import { FIGURES } from "../../pages/overviewTheme";
import { useCountUp } from "../../motion";

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
        <MoneyFigure
          key={key}
          base={base}
          amount={totals[key]}
          label={label[key]}
          // The first balance is the headline; a second or third one the reader
          // asked for sits at the same size as earned and spent.
          headline={i === 0}
          colour={negativeOnlyColor(totals[key])}
        />
      ))}
      <MoneyFigure
        label={t("overview.earned")}
        base={base}
        amount={earned}
        sign="+"
        colour={incomeColor}
      />
      <MoneyFigure
        label={t("overview.spent")}
        base={base}
        amount={spent}
        sign="−"
        colour={expenseColor}
      />
      <KeptFigure label={t("overview.kept")} kept={kept} locale={locale} />
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

/**
 * A figure in money, counting from where it was.
 *
 * The tile asks for this when a filter changes: the figure is the answer to the
 * filter, and seeing it travel says "this changed because of what you just did"
 * where a figure that swaps says nothing. Formatting happens after the count,
 * so the money face, the separators and the currency are the reader's own
 * throughout — it is the amount that moves, not the text.
 */
function MoneyFigure({
  label,
  amount,
  base,
  sign = "",
  headline,
  colour,
}: {
  label: string;
  amount: number;
  base: CurrencyInfo;
  sign?: string;
  headline?: boolean;
  colour?: string;
}) {
  const shown = useCountUp(amount);
  return (
    <Figure
      label={label}
      headline={headline}
      colour={colour}
      value={`${sign}${formatMinor(shown, base)}`}
    />
  );
}

/**
 * The share of what came in that is still here, as a percentage.
 *
 * It counts like the figures beside it — three totals where two travel and one
 * jumps reads as a bug — but a percentage carries a decimal the others do not,
 * so it is counted in tenths and divided back.
 */
function KeptFigure({
  label,
  kept,
  locale,
}: {
  label: string;
  kept: number | null;
  locale: string;
}) {
  const shown = useCountUp(Math.round((kept ?? 0) * 10));
  return (
    <Figure
      label={label}
      value={
        kept == null
          ? "—"
          : `${(shown / 10).toLocaleString(locale, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })} %`
      }
    />
  );
}
