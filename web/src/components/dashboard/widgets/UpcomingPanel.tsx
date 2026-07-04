import { ActionIcon, Badge, Box, Card, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconPlayerPlay, IconPlayerSkipForward } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ApiError,
  type CurrencyInfo,
  type Schedule,
  listSchedules,
  postScheduleNow,
  skipSchedule,
} from "../../../api/client";
import { useDateFormat } from "../../../dates";
import { formatMinor } from "../../../money";

// UpcomingPanel lists scheduled transactions in three tabs — the next due
// occurrences (with Post now / Skip), every active schedule, and the manual
// reminders — fed by the schedules list so actions can refresh it directly.
export function UpcomingPanel({ walletId, base }: { walletId: number; base?: CurrencyInfo }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const schedulesQuery = useQuery({
    queryKey: ["schedules", walletId],
    queryFn: () => listSchedules(walletId),
    enabled: walletId > 0,
  });
  const schedules = useMemo(() => schedulesQuery.data ?? [], [schedulesQuery.data]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const sortByDue = (a: Schedule, b: Schedule) => a.nextDue.localeCompare(b.nextDue);
  // Mirror HomeBank's bottom panel. remaining === 0 is exhausted and hidden
  // everywhere. Auto-post schedules split into those due now/overdue (Recurring —
  // ready to post) and those still ahead (Future); manual schedules are Reminders.
  const recurring = useMemo(
    () =>
      schedules
        .filter((s) => s.autoPost && s.remaining !== 0 && s.nextDue <= today)
        .sort(sortByDue),
    [schedules, today],
  );
  const future = useMemo(
    () =>
      schedules.filter((s) => s.autoPost && s.remaining !== 0 && s.nextDue > today).sort(sortByDue),
    [schedules, today],
  );
  const reminders = useMemo(
    () => schedules.filter((s) => !s.autoPost && s.remaining !== 0).sort(sortByDue),
    [schedules],
  );

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["schedules", walletId] });
    void qc.invalidateQueries({ queryKey: ["dashboard", walletId] });
    void qc.invalidateQueries({ queryKey: ["register", walletId] });
    void qc.invalidateQueries({ queryKey: ["accounts", walletId] });
  };
  const post = useMutation({
    mutationFn: (id: number) => postScheduleNow(walletId, id),
    onSuccess: refresh,
    onError,
  });
  const skip = useMutation({
    mutationFn: (id: number) => skipSchedule(walletId, id),
    onSuccess: refresh,
    onError,
  });

  // Each row offers post / skip / edit-before-post (edit opens the Schedules page).
  const row = (s: Schedule) => (
    <Group key={s.id} justify="space-between" wrap="nowrap" gap="xs">
      <Box style={{ minWidth: 0 }}>
        <Text size="sm" truncate>
          {s.templateName || t("schedules.untitled")}
        </Text>
        <Text size="xs" c="dimmed">
          {fmtDate(s.nextDue)}
          {` · ${t("schedules.cadence", { n: s.everyN, unit: t(`schedules.units.${s.unit}`) })}`}
        </Text>
      </Box>
      <Group gap={4} wrap="nowrap">
        {base && (
          <Text size="sm" fw={500} c={s.templateAmount < 0 ? "red" : "teal"}>
            {formatMinor(s.templateAmount, base)}
          </Text>
        )}
        <ActionIcon
          variant="subtle"
          size="sm"
          color="teal"
          aria-label={t("schedules.postNow")}
          loading={post.isPending && post.variables === s.id}
          onClick={() => post.mutate(s.id)}
        >
          <IconPlayerPlay size={15} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          size="sm"
          color="gray"
          aria-label={t("schedules.skip")}
          loading={skip.isPending && skip.variables === s.id}
          onClick={() => skip.mutate(s.id)}
        >
          <IconPlayerSkipForward size={15} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          size="sm"
          aria-label={t("schedules.edit")}
          onClick={() => navigate("/schedules")}
        >
          <IconPencil size={14} />
        </ActionIcon>
      </Group>
    </Group>
  );

  const tabLabel = (label: string, count: number) => (
    <Group gap={6} wrap="nowrap">
      {label}
      {count > 0 && (
        <Badge size="xs" variant="light" color="gray">
          {count}
        </Badge>
      )}
    </Group>
  );
  const list = (items: Schedule[], emptyMsg: string) =>
    items.length === 0 ? (
      <Text c="dimmed">{emptyMsg}</Text>
    ) : (
      <Stack gap={8}>{items.map((s) => row(s))}</Stack>
    );

  return (
    <Card withBorder h="100%">
      <Title order={4} mb="sm">
        {t("dashboard.upcoming")}
      </Title>
      <Tabs defaultValue="recurring">
        <Tabs.List mb="sm">
          <Tabs.Tab value="recurring">
            {tabLabel(t("dashboard.tabRecurring"), recurring.length)}
          </Tabs.Tab>
          <Tabs.Tab value="future">{tabLabel(t("dashboard.tabFuture"), future.length)}</Tabs.Tab>
          <Tabs.Tab value="reminders">
            {tabLabel(t("dashboard.tabReminders"), reminders.length)}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="recurring">{list(recurring, t("dashboard.noRecurring"))}</Tabs.Panel>
        <Tabs.Panel value="future">{list(future, t("dashboard.noFuture"))}</Tabs.Panel>
        <Tabs.Panel value="reminders">{list(reminders, t("dashboard.noReminders"))}</Tabs.Panel>
      </Tabs>
    </Card>
  );
}
