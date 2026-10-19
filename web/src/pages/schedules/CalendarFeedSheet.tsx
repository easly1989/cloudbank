import {
  Accordion,
  ActionIcon,
  Button,
  CopyButton,
  Group,
  Loader,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconCalendarPlus,
  IconCheck,
  IconCopy,
  IconDownload,
  IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  deleteCalendarFeed,
  downloadScheduleCalendar,
  getCalendarFeed,
  newCalendarFeed,
} from "../../api/client";
import { useConfirm } from "../../components/confirmContext";
import { SideSheet } from "../../components/SideSheet";
import { notifyError } from "../../notifyError";

/**
 * The schedules in a phone's calendar (#694): a private address the calendar
 * app subscribes to, the same calendar as a file, how to add it in the common
 * apps, and the way to give it a new address or turn it off.
 */
export function CalendarFeedSheet({
  opened,
  onClose,
  walletId,
  walletTitle,
}: {
  opened: boolean;
  onClose: () => void;
  walletId: number;
  walletTitle: string;
}) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const key = ["calendar-feed", walletId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getCalendarFeed(walletId),
    enabled: opened && walletId > 0,
  });
  const onError = (e: unknown) => notifyError(e);
  const make = useMutation({
    mutationFn: () => newCalendarFeed(walletId),
    onSuccess: (r) => qc.setQueryData(key, r),
    onError,
  });
  const off = useMutation({
    mutationFn: () => deleteCalendarFeed(walletId),
    onSuccess: () => qc.setQueryData(key, { feed: null }),
    onError,
  });
  const feed = query.data?.feed ?? null;
  const url = feed ? `${location.origin}/ical/${feed.id}/${feed.token}.ics` : "";

  const regenerate = async () => {
    const ok = await confirm({
      title: t("schedules.feed.regenerateTitle"),
      body: t("schedules.feed.regenerateBody"),
      confirmLabel: t("schedules.feed.regenerate"),
      danger: true,
    });
    if (ok) make.mutate();
  };
  const turnOff = async () => {
    const ok = await confirm({
      title: t("schedules.feed.offTitle"),
      body: t("schedules.feed.offBody"),
      confirmLabel: t("schedules.feed.off"),
      danger: true,
    });
    if (ok) off.mutate();
  };

  return (
    <SideSheet
      opened={opened}
      onClose={onClose}
      testId="calendar-feed-sheet"
      title={t("schedules.feed.title")}
      subtitle={t("schedules.feed.sub", { wallet: walletTitle })}
    >
      {query.isPending ? (
        <Loader size="sm" />
      ) : !feed ? (
        <Stack gap="sm">
          <Text size="sm">{t("schedules.feed.intro")}</Text>
          <Group gap="xs">
            <Button
              leftSection={<IconCalendarPlus size={16} />}
              onClick={() => make.mutate()}
              loading={make.isPending}
            >
              {t("schedules.feed.create")}
            </Button>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={() => void downloadScheduleCalendar(walletId).catch(onError)}
            >
              {t("schedules.feed.download")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <Stack gap="md">
          <Text size="sm">{t("schedules.feed.explain")}</Text>
          <Stack gap={6}>
            <TextInput
              label={t("schedules.feed.address")}
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              data-testid="calendar-feed-url"
              data-cb-sensitive
              styles={{
                input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 12.5 },
              }}
              rightSection={
                <CopyButton value={url}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? t("schedules.feed.copied") : t("schedules.feed.copy")}>
                      <ActionIcon
                        variant="subtle"
                        onClick={copy}
                        aria-label={t("schedules.feed.copy")}
                      >
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              }
            />
            <Text size="xs" c="var(--cb-attention)">
              {t("schedules.feed.private")}
            </Text>
          </Stack>
          <Group gap="xs">
            <Button
              component="a"
              href={url.replace(/^https?:/, "webcal:")}
              leftSection={<IconCalendarPlus size={16} />}
            >
              {t("schedules.feed.subscribe")}
            </Button>
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={() => void downloadScheduleCalendar(walletId).catch(onError)}
            >
              {t("schedules.feed.download")}
            </Button>
          </Group>
          <Accordion variant="separated">
            {(["google", "apple", "outlook"] as const).map((app) => (
              <Accordion.Item key={app} value={app}>
                <Accordion.Control>{t(`schedules.feed.${app}`)}</Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm">{t(`schedules.feed.${app}How`)}</Text>
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
          <Stack gap={4}>
            <Group gap="xs">
              <Button
                variant="subtle"
                color="red"
                size="xs"
                leftSection={<IconRefresh size={14} />}
                onClick={() => void regenerate()}
                loading={make.isPending}
              >
                {t("schedules.feed.regenerate")}
              </Button>
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                onClick={() => void turnOff()}
                loading={off.isPending}
              >
                {t("schedules.feed.off")}
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              {t("schedules.feed.regenerateHint")}
            </Text>
          </Stack>
        </Stack>
      )}
    </SideSheet>
  );
}
