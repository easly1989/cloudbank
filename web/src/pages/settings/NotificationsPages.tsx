import {
  Anchor,
  Box,
  Card,
  Checkbox,
  Divider,
  Group,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import {
  IconBell,
  IconBrandDiscord,
  IconBrandMatrix,
  IconBrandSlack,
  IconBrandTelegram,
  IconChevronLeft,
  IconChevronRight,
  IconDeviceMobile,
  IconMail,
  IconWebhook,
  type Icon,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router-dom";

import { GUIDE_BASE_URL } from "../../aboutLinks";
import { attentionColor, errorColor } from "../../amountTone";
import {
  getNotificationPreferences,
  setNotificationPreference,
  type AddressedChannel,
  type NotificationChannel,
  type NotificationPreference,
} from "../../api/client";
import { ChannelSetup, failureText, useChannel } from "../../components/NotificationChannelCards";
import { NotificationsCard } from "../../components/NotificationsCard";
import { notifyError } from "../../notifyError";
import { currentPushSubscription, pushSupported } from "../../push";
import { SettingsGroup } from "./SettingsLayout";
import classes from "./NotificationsPages.module.css";

// Settings › Notifications (#688): an overview of every channel, and a page
// per channel with how it is connected and which events it gets. The demo
// build has only the bell.

const CHANNELS: { id: NotificationChannel; icon: Icon }[] = [
  { id: "inapp", icon: IconBell },
  { id: "push", icon: IconDeviceMobile },
  { id: "email", icon: IconMail },
  { id: "matrix", icon: IconBrandMatrix },
  { id: "telegram", icon: IconBrandTelegram },
  { id: "discord", icon: IconBrandDiscord },
  { id: "slack", icon: IconBrandSlack },
  { id: "webhook", icon: IconWebhook },
];
const shown = (id: NotificationChannel) => !__DEMO__ || id === "inapp";
const addressed = (id: NotificationChannel): id is AddressedChannel =>
  id !== "inapp" && id !== "push";

// The guide's section for each channel that has one.
const GUIDE: Partial<Record<NotificationChannel, string>> = {
  email: "channels",
  matrix: "matrix",
  telegram: "telegram",
  discord: "discord",
  slack: "slack",
  webhook: "the-webhook",
};

type PushState = "on" | "off" | "unsupported" | "denied";

/** Push is on or off per device: what this browser says. */
function usePushState(): PushState {
  const [state, setState] = useState<PushState>(() =>
    !pushSupported()
      ? "unsupported"
      : typeof Notification !== "undefined" && Notification.permission === "denied"
        ? "denied"
        : "off",
  );
  useEffect(() => {
    if (state !== "off") return;
    void currentPushSubscription().then((s) => s && setState("on"));
  }, [state]);
  return state;
}

type Status = { text: string; error?: boolean; attention?: boolean; active: boolean };

const statusColor = (s: Status) => (s.error ? errorColor : s.attention ? attentionColor : "dimmed");

/** One line on how a channel stands, and whether it gets anything now. */
function useStatus(id: NotificationChannel): Status {
  const { t, i18n } = useTranslation();
  const push = usePushState();
  const state = useChannel(addressed(id) ? id : "email");
  if (id === "inapp") return { text: t("notif.status.always"), active: true };
  if (id === "push") return { text: t(`notif.status.push.${push}`), active: push === "on" };
  if (!state) return { text: "", active: false };
  if (!state.available) return { text: t("notif.status.unavailable"), active: false };
  if (!state.configured) return { text: t("notif.status.notLinked"), active: false };
  if (state.pending) return { text: t("notif.status.pending"), attention: true, active: false };
  if (state.lastError) return { text: failureText(t, state.lastError), error: true, active: true };
  if (state.lastOkAt) {
    const when = new Date(state.lastOkAt).toLocaleString(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return { text: t("notif.status.linkedOk", { when }), active: true };
  }
  return { text: t("notif.status.linked"), active: true };
}

const PREFS_KEY = ["notification-preferences"] as const;

function usePreferences() {
  const { data } = useQuery({ queryKey: PREFS_KEY, queryFn: getNotificationPreferences });
  return data?.events ?? [];
}

function ChannelRow({
  id,
  icon: ChannelIcon,
  events,
}: {
  id: NotificationChannel;
  icon: Icon;
  events: NotificationPreference[];
}) {
  const { t } = useTranslation();
  const status = useStatus(id);
  const on = events.filter((e) => e.channels[id]).length;
  return (
    <UnstyledButton component={Link} to={`/settings/notifications/${id}`} className={classes.row}>
      <Box className={classes.icon}>
        <ChannelIcon size={16} />
      </Box>
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Text fz={14} fw={500}>
          {t(`notif.name.${id}`)}
        </Text>
        <Text fz={13} c={statusColor(status)} truncate>
          {status.text}
        </Text>
      </Box>
      {status.active && events.length > 0 && (
        <Text fz={13} c="dimmed" visibleFrom="sm">
          {t("notif.eventCount", { on, total: events.length })}
        </Text>
      )}
      <IconChevronRight size={16} className={classes.chevron} />
    </UnstyledButton>
  );
}

/** Settings › Notifications: every channel, how it stands, one click away. */
export function NotificationsSection() {
  const { t } = useTranslation();
  const events = usePreferences();
  const channels = CHANNELS.filter((c) => shown(c.id));
  return (
    <SettingsGroup title={t("notif.channels")} hint={t("notif.channelsHint")}>
      <Card withBorder p={0}>
        {channels.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && <Divider />}
            <ChannelRow id={c.id} icon={c.icon} events={events} />
          </Fragment>
        ))}
      </Card>
    </SettingsGroup>
  );
}

/** The events one channel gets, ticked on that channel's page. */
function ChannelEvents({ id, active }: { id: NotificationChannel; active: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const events = usePreferences();
  const save = useMutation({
    mutationFn: (v: { kind: NotificationPreference["kind"]; on: boolean }) =>
      setNotificationPreference(v.kind, id, v.on),
    // Tick at once; the server's answer settles it.
    onMutate: async (v) => {
      // A fetch still on its way would land after the tick and undo it.
      await qc.cancelQueries({ queryKey: PREFS_KEY });
      qc.setQueryData<{ events: NotificationPreference[] }>(
        PREFS_KEY,
        (old) =>
          old && {
            events: old.events.map((e) =>
              e.kind === v.kind ? { ...e, channels: { ...e.channels, [id]: v.on } } : e,
            ),
          },
      );
    },
    onError: notifyError,
    onSettled: () => qc.invalidateQueries({ queryKey: PREFS_KEY }),
  });
  const groups = [...new Set(events.map((e) => e.group))];
  return (
    <Card withBorder p={0} pb="xs">
      {!active && (
        <Text size="sm" c="dimmed" px="md" pt="sm">
          {t("notif.connectFirst")}
        </Text>
      )}
      {groups.map((g, i) => (
        <Fragment key={g}>
          {i > 0 && <Divider mt="xs" />}
          <Text fz={13} fw={600} px="md" pt="sm" pb={4}>
            {t(`notif.group.${g}`)}
          </Text>
          {events
            .filter((e) => e.group === g)
            .map((e) => (
              <Checkbox
                key={e.kind}
                px="md"
                py="xs"
                disabled={!active}
                checked={e.channels[id]}
                onChange={(ev) => save.mutate({ kind: e.kind, on: ev.currentTarget.checked })}
                label={t(`notif.kind.${e.kind}`)}
                description={t(`notif.kindHint.${e.kind}`)}
              />
            ))}
        </Fragment>
      ))}
    </Card>
  );
}

/** Settings › Notifications › a channel: how it is connected, what it gets. */
export function NotificationChannelSection() {
  const { t } = useTranslation();
  const { channel } = useParams();
  const meta = CHANNELS.find((c) => c.id === channel && shown(c.id));
  // Hooks run before the redirect, so give them a channel either way.
  const id = meta?.id ?? "inapp";
  const status = useStatus(id);
  if (!meta) return <Navigate to="/settings/notifications" replace />;
  const ChannelIcon = meta.icon;
  const guide = GUIDE[id];
  return (
    <Stack gap="xl">
      <div>
        <Anchor component={Link} to="/settings/notifications" size="sm">
          <Group gap={4} component="span">
            <IconChevronLeft size={14} />
            {t("notif.title")}
          </Group>
        </Anchor>
        <Group gap="xs" mt="xs" wrap="nowrap">
          <ChannelIcon size={20} />
          <Title order={3} fz={20}>
            {t(`notif.name.${id}`)}
          </Title>
        </Group>
        <Text fz={13} c={statusColor(status)} mt={2}>
          {status.text}
        </Text>
      </div>
      {id !== "inapp" && (
        <SettingsGroup
          title={t("notif.connection")}
          hint={t(`notif.about.${id}`)}
          action={
            guide && (
              <Anchor
                href={`${GUIDE_BASE_URL}notifications.md#${guide}`}
                target="_blank"
                rel="noreferrer"
                size="sm"
              >
                {t("notif.webhookGuide")}
              </Anchor>
            )
          }
        >
          {id === "push" ? <NotificationsCard /> : addressed(id) && <ChannelSetup channel={id} />}
        </SettingsGroup>
      )}
      <SettingsGroup
        title={t("notif.whatArrives")}
        hint={id === "inapp" ? t("notif.about.inapp") : t("notif.whatArrivesHint")}
      >
        {/* Push is per device: its events can be chosen before this one is on. */}
        <ChannelEvents id={id} active={status.active || id === "push"} />
      </SettingsGroup>
    </Stack>
  );
}
