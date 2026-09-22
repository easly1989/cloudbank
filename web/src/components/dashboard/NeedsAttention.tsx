import { Anchor, Box, Group, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { getBills, getBudgetReport, getTransactionReview } from "../../api/client";
import { attentionColor } from "../../amountTone";
import { buildAttentionItems, countOverBudget, monthRange } from "./attention";

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
    <Box
      p="md"
      style={{
        border: `1px solid ${attentionColor}`,
        borderRadius: "var(--mantine-radius-md)",
      }}
    >
      <Stack gap="xs">
        <Text fw={600} size="sm">
          {t("attention.title", { count: items.length })}
        </Text>
        {items.map((item) => (
          <Group key={item.key} gap="sm" wrap="nowrap" align="baseline">
            <Text ff="monospace" fw={600} size="sm" style={{ minWidth: "2.5ch" }}>
              {item.count}
            </Text>
            <Text size="sm" c="dimmed">
              {t(`attention.${item.key}`, { count: item.count })}
            </Text>
            <Anchor component={Link} to={item.to} size="sm" fw={600} ml="auto">
              {t(`attention.${item.key}Action`)}
            </Anchor>
          </Group>
        ))}
      </Stack>
    </Box>
  );
}
