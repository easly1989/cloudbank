import { ActionIcon, Badge, Box, Group, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError, type Bill, type BillState, getBills, postScheduleNow } from "../api/client";
import { useDateFormat } from "../dates";
import { formatMinor } from "../money";

const STATE_COLOR: Record<BillState, string> = {
  overdue: "red",
  due: "yellow",
};

// BillsList renders one row per bill (a scheduled outflow): its last successful
// payment and its next occurrence, classified overdue / due, with a base-currency
// "left to pay" total and a one-click "mark paid" (which posts the scheduled
// transaction). Both the dashboard widget and the dedicated Bills page render
// this, differing only via `compact` / `limit` (widget: cap the rows).
export function BillsList({
  walletId,
  limit,
}: {
  walletId: number;
  compact?: boolean;
  limit?: number;
}) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["bills", walletId],
    queryFn: () => getBills(walletId),
    enabled: walletId > 0,
  });
  const data = query.data;
  const base = data?.baseCurrency ?? undefined;
  const bills = data?.bills ?? [];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["bills", walletId] });
    void qc.invalidateQueries({ queryKey: ["schedules", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
  };
  const post = useMutation({
    mutationFn: (scheduleId: number) => postScheduleNow(walletId, scheduleId),
    onSuccess: () => {
      refresh();
      notifications.show({ color: "green", message: t("bills.marked"), autoClose: 1600 });
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  const stateLabel = (s: BillState) => t(`bills.state.${s}`);

  const row = (b: Bill) => {
    // Auto-post bills post themselves, so they get no manual "mark paid".
    const postable = !b.autoPost;
    return (
      <Group key={b.scheduleId} justify="space-between" wrap="nowrap" gap="xs">
        <Box style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" truncate>
              {b.name}
            </Text>
            <Badge size="xs" variant="light" color={STATE_COLOR[b.state]}>
              {stateLabel(b.state)}
            </Badge>
            {b.autoPost && (
              <Badge size="xs" variant="outline" color="gray">
                {t("bills.auto")}
              </Badge>
            )}
          </Group>
          <Text size="xs" c="dimmed" truncate>
            {t("bills.next")}: {fmtDate(b.dueDate)}
            {b.lastPaid ? ` · ${t("bills.lastPaid")}: ${fmtDate(b.lastPaid)}` : ""}
            {b.accountName ? ` · ${b.accountName}` : ""}
          </Text>
        </Box>
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={500} c={b.amount < 0 ? "red" : "teal"}>
            {formatMinor(b.amount, b.currency)}
          </Text>
          {postable ? (
            <Tooltip label={t("bills.markPaid")} withArrow>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="teal"
                aria-label={t("bills.markPaid")}
                loading={post.isPending && post.variables === b.scheduleId}
                onClick={() => post.mutate(b.scheduleId)}
              >
                <IconCheck size={16} />
              </ActionIcon>
            </Tooltip>
          ) : (
            // Keep rows aligned when there's no action.
            <Box w={28} />
          )}
        </Group>
      </Group>
    );
  };

  if (query.isError) return <Text c="red">{t("bills.error")}</Text>;

  const shown = limit != null ? bills.slice(0, limit) : bills;
  const hiddenCount = bills.length - shown.length;

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600}>
          {base ? formatMinor(data?.totalDue ?? 0, base) : (data?.totalDue ?? 0)} {t("bills.toPay")}
        </Text>
        <Group gap={6} wrap="nowrap">
          {(data?.overdue ?? 0) > 0 && (
            <Badge size="sm" color="red" variant="light">
              {t("bills.overdueCount", { count: data?.overdue ?? 0 })}
            </Badge>
          )}
          {(data?.due ?? 0) > 0 && (
            <Badge size="sm" color="yellow" variant="light">
              {t("bills.dueCount", { count: data?.due ?? 0 })}
            </Badge>
          )}
        </Group>
      </Group>

      {shown.length === 0 ? (
        <Text c="dimmed">{t("bills.empty")}</Text>
      ) : (
        <Stack gap={8}>{shown.map((b) => row(b))}</Stack>
      )}
      {hiddenCount > 0 && (
        <Text size="xs" c="dimmed">
          {t("bills.more", { count: hiddenCount })}
        </Text>
      )}
    </Stack>
  );
}
