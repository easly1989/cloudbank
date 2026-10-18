import { Card, Checkbox, Table, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import {
  NOTIFICATION_CHANNELS_KEY,
  getNotificationPreferences,
  listNotificationChannels,
  setNotificationPreference,
  type NotificationChannel,
  type NotificationPreference,
} from "../api/client";
import { notifyError } from "../notifyError";

const PREFS_KEY = ["notification-preferences"] as const;

// Every event, in its group, with one box per channel (#685). The demo build
// has no push, so it shows only the bell's column; email and webhook join once
// the reader has set them up (#686).
const BASE: NotificationChannel[] = __DEMO__ ? ["inapp"] : ["inapp", "push"];

export function NotificationPrefsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // A phone keeps the event its width: the boxes need no more than their header.
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const { data } = useQuery({ queryKey: PREFS_KEY, queryFn: getNotificationPreferences });
  const { data: chans } = useQuery({
    queryKey: NOTIFICATION_CHANNELS_KEY,
    queryFn: listNotificationChannels,
    enabled: !__DEMO__,
  });
  const CHANNELS = [
    ...BASE,
    ...(chans?.channels ?? []).filter((c) => c.configured).map((c) => c.channel),
  ];
  const save = useMutation({
    mutationFn: (v: {
      kind: NotificationPreference["kind"];
      channel: NotificationChannel;
      on: boolean;
    }) => setNotificationPreference(v.kind, v.channel, v.on),
    // Tick at once; the server's answer settles it.
    onMutate: async (v) => {
      // A fetch still on its way would land after the tick and undo it.
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      qc.setQueryData<{ events: NotificationPreference[] }>(
        PREFS_KEY,
        (old) =>
          old && {
            events: old.events.map((e) =>
              e.kind === v.kind ? { ...e, channels: { ...e.channels, [v.channel]: v.on } } : e,
            ),
          },
      );
    },
    onError: notifyError,
    onSettled: () => qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });
  const events = data?.events ?? [];
  const groups = [...new Set(events.map((e) => e.group))];
  // Past two channels a phone has no width left for the event beside its boxes,
  // so the event takes a row of its own above them.
  const stacked = phone && CHANNELS.length > 2;
  const span = CHANNELS.length + (stacked ? 0 : 1);
  const label = (e: NotificationPreference) => (
    <>
      <Text fz={14}>{t(`notif.kind.${e.kind}`)}</Text>
      <Text fz={13} c="dimmed">
        {t(`notif.kindHint.${e.kind}`)}
      </Text>
    </>
  );
  const boxes = (e: NotificationPreference) =>
    CHANNELS.map((ch) => (
      <Table.Td key={ch} pt={stacked ? 0 : undefined}>
        <Checkbox
          mx="auto"
          w="fit-content"
          checked={e.channels[ch]}
          onChange={(ev) =>
            save.mutate({ kind: e.kind, channel: ch, on: ev.currentTarget.checked })
          }
          aria-label={`${t(`notif.kind.${e.kind}`)}: ${t(`notif.channel.${ch}`)}`}
        />
      </Table.Td>
    ));

  return (
    <Card withBorder p={0}>
      <Table verticalSpacing="sm" horizontalSpacing={phone ? "xs" : "md"}>
        <Table.Thead>
          <Table.Tr>
            {!stacked && <Table.Th>{t("notif.eventHeader")}</Table.Th>}
            {CHANNELS.map((ch) => (
              <Table.Th key={ch} w={stacked ? undefined : phone ? 64 : 84} ta="center">
                {t(`notif.channel.${ch}`)}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <Table.Tr bg="var(--cb-band-notice)">
                <Table.Td colSpan={span}>
                  <Text fz={13} fw={600}>
                    {t(`notif.group.${g}`)}
                  </Text>
                </Table.Td>
              </Table.Tr>
              {events
                .filter((e) => e.group === g)
                .map((e) =>
                  stacked ? (
                    <Fragment key={e.kind}>
                      <Table.Tr style={{ borderBottom: 0 }}>
                        <Table.Td colSpan={span}>{label(e)}</Table.Td>
                      </Table.Tr>
                      <Table.Tr>{boxes(e)}</Table.Tr>
                    </Fragment>
                  ) : (
                    <Table.Tr key={e.kind}>
                      <Table.Td>{label(e)}</Table.Td>
                      {boxes(e)}
                    </Table.Tr>
                  ),
                )}
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
