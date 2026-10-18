import { Card, Checkbox, Table, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import {
  getNotificationPreferences,
  setNotificationPreference,
  type NotificationChannel,
  type NotificationPreference,
} from "../api/client";
import { notifyError } from "../notifyError";

const PREFS_KEY = ["notification-preferences"] as const;

// Every event, in its group, with one box per channel (#685). The demo build
// has no push, so it shows only the bell's column.
const CHANNELS: NotificationChannel[] = __DEMO__ ? ["inapp"] : ["inapp", "push"];

export function NotificationPrefsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // A phone keeps the event its width: the boxes need no more than their header.
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const { data } = useQuery({ queryKey: PREFS_KEY, queryFn: getNotificationPreferences });
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

  return (
    <Card withBorder p={0}>
      <Table verticalSpacing="sm" horizontalSpacing={phone ? "xs" : "md"}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("notif.eventHeader")}</Table.Th>
            {CHANNELS.map((ch) => (
              <Table.Th key={ch} w={phone ? 64 : 84} ta="center">
                {t(`notif.channel.${ch}`)}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <Table.Tr bg="var(--cb-band-notice)">
                <Table.Td colSpan={CHANNELS.length + 1}>
                  <Text fz={13} fw={600}>
                    {t(`notif.group.${g}`)}
                  </Text>
                </Table.Td>
              </Table.Tr>
              {events
                .filter((e) => e.group === g)
                .map((e) => (
                  <Table.Tr key={e.kind}>
                    <Table.Td>
                      <Text fz={14}>{t(`notif.kind.${e.kind}`)}</Text>
                      <Text fz={13} c="dimmed">
                        {t(`notif.kindHint.${e.kind}`)}
                      </Text>
                    </Table.Td>
                    {CHANNELS.map((ch) => (
                      <Table.Td key={ch}>
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
                    ))}
                  </Table.Tr>
                ))}
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}
