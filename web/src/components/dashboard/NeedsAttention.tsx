import { Anchor, Box, Group, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { getBills, getBudgetReport, getTransactionReview } from "../../api/client";
import { buildAttentionItems, countOverBudget, monthRange } from "./attention";
import { ATTENTION } from "../../pages/overviewTheme";

/**
 * What the overview opens with: the handful of things that want doing.
 *
 * A dashboard that only reports what happened leaves the reader to work out
 * what to do about it. This does that part — uncategorised transactions,
 * overdue bills, budgets gone past, possible duplicates — each with the one
 * link that fixes it.
 *
 * It renders nothing at all when there is nothing to do, which is the point:
 * seeing it means something is genuinely waiting.
 *
 * Every figure here is already fetched elsewhere on the page, under the same
 * query keys, so on a dashboard carrying the bills or budget widgets this costs
 * no extra requests.
 */
export function NeedsAttention({ walletId }: { walletId: number }) {
  const { t } = useTranslation();
  const { from, to } = useMemo(() => monthRange(), []);

  const review = useQuery({
    queryKey: ["review", walletId],
    queryFn: () => getTransactionReview(walletId),
    enabled: walletId > 0,
  });
  const bills = useQuery({
    queryKey: ["bills", walletId],
    queryFn: () => getBills(walletId),
    enabled: walletId > 0,
  });
  const budget = useQuery({
    queryKey: ["budgetReport", walletId, from, to, true],
    queryFn: () => getBudgetReport(walletId, from, to, true),
    enabled: walletId > 0,
  });

  const items = buildAttentionItems({
    needsCategory: review.data?.needsCategory.length ?? 0,
    duplicates: review.data?.duplicates.length ?? 0,
    overdueBills: bills.data?.overdue ?? 0,
    overBudget: countOverBudget(budget.data?.rows),
  });

  if (items.length === 0) return null;

  return (
    <Box className="cb-attention">
      <Stack gap={ATTENTION.gap}>
        <Text fz={ATTENTION.title.fz} fw={ATTENTION.title.fw}>
          {t("attention.title", { count: items.length })}
        </Text>
        <Stack gap={ATTENTION.listGap}>
          {items.map((item) => (
            <Group key={item.key} gap={ATTENTION.rowGap} wrap="nowrap" align="baseline">
              <Text
                ff="monospace"
                fz={ATTENTION.count.fz}
                fw={ATTENTION.count.fw}
                style={{ minWidth: ATTENTION.count.width }}
              >
                {item.count}
              </Text>
              <Text fz={ATTENTION.text.fz} c="dimmed">
                {t(`attention.${item.key}`, { count: item.count })}
              </Text>
              <Anchor
                component={Link}
                to={item.to}
                className="cb-attention-action"
                fz={ATTENTION.action.fz}
                fw={ATTENTION.action.fw}
                ml="auto"
                style={{ whiteSpace: "nowrap" }}
              >
                {t(`attention.${item.key}Action`)}
              </Anchor>
            </Group>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}
