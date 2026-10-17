import { Box, Button, Card, Group, Stack, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconArrowBackUp,
  IconBuildingBank,
  IconGitMerge,
  IconMail,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";

import {
  type Account,
  type ReversalPair,
  type ReviewTxn,
  type UnconfirmedRow,
  bulkDeleteTransactions,
  mergeMailTransaction,
} from "../api/client";
import { amountColor } from "../amountTone";
import { useConfirm } from "../components/confirmContext";
import { useDateFormat } from "../dates";
import { formatMinor, type MoneyFormat } from "../money";
import { notifyError } from "../notifyError";

const RULE = "1px solid var(--mantine-color-default-border)";
const DASHED = "1px dashed var(--mantine-color-default-border)";

/** Whole days from a civil date to today. */
function daysSince(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const now = new Date();
  return Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) /
      86_400_000,
  );
}

/**
 * The rows read from bank mails that the bank has not booked after 5 days
 * (#660): each with the bank rows near it to merge with, or to delete; and a
 * refused card's payment and reversal, which cancel out, to delete together.
 */
export function ReviewUnconfirmed({
  walletId,
  unconfirmed,
  reversals,
  accountById,
  fmtFor,
  categoryName,
  onChanged,
}: {
  walletId: number;
  unconfirmed: UnconfirmedRow[];
  reversals: ReversalPair[];
  accountById: Map<number, Account>;
  fmtFor: (acc?: Account) => MoneyFormat;
  categoryName: (id?: number | null) => string;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const fmtDate = useDateFormat();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;

  const merge = useMutation({
    mutationFn: (v: { mailId: number; bankId: number }) =>
      mergeMailTransaction(walletId, v.mailId, v.bankId),
    onSuccess: () => {
      onChanged();
      notifications.show({ color: "green", message: t("review.merged"), autoClose: 1600 });
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteTransactions(walletId, ids),
    onSuccess: onChanged,
    onError: notifyError,
  });

  const money = (tx: ReviewTxn) => formatMinor(tx.amount, fmtFor(accountById.get(tx.accountId)));

  const deleteButton = (ids: number[], label: string, title: string) => (
    <Button
      size="xs"
      variant="subtle"
      color="red"
      leftSection={<IconTrash size={14} />}
      loading={remove.isPending}
      style={{ flexShrink: 0 }}
      onClick={async () => {
        const ok = await confirm({
          title,
          body: t("transactions.confirmDeleteBody"),
          confirmLabel: t("transactions.confirmDeleteAction"),
          danger: true,
        });
        if (ok) remove.mutate(ids);
      }}
    >
      {label}
    </Button>
  );

  // One line of a nested list: a bank row to merge with, or a side of a pair.
  const line = (tx: ReviewTxn, icon: ReactNode, action?: ReactNode) => (
    <Group
      key={tx.id}
      gap={phone ? "4px 12px" : "sm"}
      wrap={phone ? "wrap" : "nowrap"}
      py={6}
      style={{ borderTop: DASHED }}
    >
      {icon}
      <Text size="xs" ff="monospace" style={{ flexShrink: 0 }}>
        {fmtDate(tx.date)}
      </Text>
      <Text
        size="xs"
        truncate={!phone}
        style={
          phone
            ? { flexBasis: "100%", order: 5, paddingLeft: 26, overflowWrap: "anywhere" }
            : { flex: 1, minWidth: 0 }
        }
        data-cb-sensitive={!!tx.memo || undefined}
      >
        {tx.memo || t("review.noMemo")}
      </Text>
      <Text
        size="xs"
        ff="monospace"
        fw={600}
        c={amountColor(tx.amount)}
        style={{ flexShrink: 0, marginLeft: phone ? "auto" : undefined }}
        data-cb-sensitive
      >
        {money(tx)}
      </Text>
      {action}
    </Group>
  );

  const iconStyle = { flexShrink: 0, opacity: 0.6 };

  return (
    <Card withBorder data-testid="review-unconfirmed" data-tour="review-unconfirmed">
      <Stack gap="sm">
        <Stack gap={4}>
          <Text fw={600}>
            {t("review.unconfirmed", { count: unconfirmed.length + reversals.length })}
          </Text>
          <Text size="sm" c="dimmed" maw={720}>
            <Trans i18nKey="review.unconfirmedHint" components={{ b: <b /> }} />
          </Text>
        </Stack>

        {reversals.map((p) => {
          const acc = accountById.get(p.payment.accountId);
          const removeBoth = deleteButton(
            [p.payment.id, p.reversal.id],
            t("review.deleteBoth"),
            t("review.confirmDeleteBothTitle"),
          );
          return (
            <Box
              key={`${p.payment.id}:${p.reversal.id}`}
              pt="sm"
              style={{ borderTop: RULE }}
              data-testid="review-reversal"
            >
              <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <IconArrowBackUp size={15} style={iconStyle} />
                    <Text size="sm" fw={600}>
                      {t("review.reversal")}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {t("review.reversalHint", { account: acc?.name ?? "" })}
                  </Text>
                </Box>
                {!phone && removeBoth}
              </Group>
              <Stack gap={0} mt={8} ml={21}>
                {[p.payment, p.reversal].map((tx) =>
                  line(tx, <IconMail size={14} style={iconStyle} />),
                )}
              </Stack>
              {phone && <Box mt={4}>{removeBoth}</Box>}
            </Box>
          );
        })}

        {unconfirmed.map((u) => {
          const acc = accountById.get(u.accountId);
          const category = u.isSplit ? t("transactions.split") : categoryName(u.categoryId);
          const removeOne = deleteButton(
            [u.id],
            t("review.delete"),
            t("transactions.confirmDeleteTitle"),
          );
          const head = (
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <IconMail size={15} style={iconStyle} />
                  <Text size="sm" fw={600} truncate data-cb-sensitive={!!u.memo || undefined}>
                    {u.memo || t("review.noMemo")}
                  </Text>
                </Group>
                <Text
                  size="sm"
                  fw={600}
                  ff="monospace"
                  c={amountColor(u.amount)}
                  style={{ flexShrink: 0 }}
                  data-cb-sensitive
                >
                  {money(u)}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {[
                  fmtDate(u.date),
                  acc?.name,
                  t("review.mailAge", { count: daysSince(u.date) }),
                  category,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Box>
          );
          return (
            <Box
              key={u.id}
              pt="sm"
              style={{ borderTop: RULE }}
              data-testid="review-unconfirmed-row"
            >
              {phone ? (
                head
              ) : (
                <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                  {head}
                  {removeOne}
                </Group>
              )}
              {u.bankRows.length > 0 ? (
                <Stack gap={0} mt={8} ml={21}>
                  <Text size="xs" c="dimmed" mb={2}>
                    {t("review.bankRows")}
                  </Text>
                  {u.bankRows.map((b) =>
                    line(
                      b,
                      <IconBuildingBank size={14} style={iconStyle} />,
                      <Button
                        size="compact-xs"
                        variant="light"
                        leftSection={<IconGitMerge size={13} />}
                        style={{ flexShrink: 0 }}
                        loading={merge.isPending}
                        onClick={() => merge.mutate({ mailId: u.id, bankId: b.id })}
                      >
                        {t("review.merge")}
                      </Button>,
                    ),
                  )}
                </Stack>
              ) : (
                <Text size="xs" c="dimmed" mt={6} ml={21}>
                  {t("review.noBankRows")}
                </Text>
              )}
              {phone && <Box mt={4}>{removeOne}</Box>}
            </Box>
          );
        })}
      </Stack>
    </Card>
  );
}
