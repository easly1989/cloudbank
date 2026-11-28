import { Anchor, Checkbox, Stack, Text } from "@mantine/core";
import {
  IconAlertTriangle,
  IconBell,
  IconCoin,
  IconRobot,
  IconShieldLock,
  IconSum,
  IconUserShield,
  type Icon,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router-dom";

import { GUIDE_BASE_URL } from "../../aboutLinks";
import {
  getNotificationPreferences,
  NOTIFICATION_PREFERENCES_KEY,
  setNotificationPreference,
  type AddressedChannel,
  type NotificationChannel,
  type NotificationPreference,
} from "../../api/client";
import { ChannelSetup, failureText, useChannel } from "../../components/NotificationChannelCards";
import { NotificationsCard } from "../../components/NotificationsCard";
import { notifyError } from "../../notifyError";
import { currentPushSubscription, pushSupported } from "../../push";
import { MoneyRow } from "./NotificationMoney";
import { TimingRow } from "./NotificationTiming";
import { CHANNELS } from "./sections";
import { RelatedSettings, SettingRow, SettingsGroup, SettingState } from "./SettingRow";

// Settings › Notifications (#688): an overview of every channel, and a page
// per channel with how it is connected and which events it gets. The demo
// build has only the bell.

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
  ntfy: "ntfy",
  gotify: "gotify",
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

const tone = (s: Status) => (s.error ? "error" : s.attention ? "warn" : s.active ? "ok" : "off");

// Each group of events, with the icon its row on a channel's page carries.
const GROUP_ICON: Record<string, Icon> = {
  security: IconShieldLock,
  problems: IconAlertTriangle,
  bills: IconBell,
  money: IconCoin,
  admin: IconUserShield,
  summaries: IconSum,
  ai: IconRobot,
};

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

const PREFS_KEY = NOTIFICATION_PREFERENCES_KEY;

function usePreferences() {
  const { data } = useQuery({ queryKey: PREFS_KEY, queryFn: getNotificationPreferences });
  return data?.events ?? [];
}

function ChannelRow({ id, events }: { id: NotificationChannel; events: NotificationPreference[] }) {
  const { t } = useTranslation();
  const status = useStatus(id);
  const on = events.filter((e) => e.channels[id]).length;
  return (
    <SettingRow
      id={`notif-${id}`}
      description={
        <span style={{ color: status.error ? "var(--cb-error)" : undefined }}>{status.text}</span>
      }
      control={
        status.active &&
        events.length > 0 && (
          <SettingState>{t("notif.eventCount", { on, total: events.length })}</SettingState>
        )
      }
    />
  );
}

/** Settings › Notifications: every channel, how it stands, one click away. */
export function NotificationsSection() {
  const { t } = useTranslation();
  const events = usePreferences();
  const channels = CHANNELS.filter((c) => shown(c.id));
  return (
    <>
      <SettingsGroup title={t("notif.channels")}>
        {channels.map((c) => (
          <ChannelRow key={c.id} id={c.id} events={events} />
        ))}
      </SettingsGroup>
      <SettingsGroup title={t("settings.notifRules")}>
        <MoneyRow />
        {/* Timing is about the channels outside the app, which the demo has none of. */}
        {!__DEMO__ && <TimingRow />}
      </SettingsGroup>
    </>
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
    <>
      {!active && (
        <Text size="sm" c="dimmed">
          {t("notif.connectFirst")}
        </Text>
      )}
      {groups.map((g) => {
        const list = events.filter((e) => e.group === g);
        const on = list.filter((e) => e.channels[id]).length;
        // A security event always reaches the bell (#690).
        const always = g === "security" && id === "inapp";
        return (
          <SettingRow
            key={g}
            icon={GROUP_ICON[g] ?? IconBell}
            title={t(`notif.group.${g}`)}
            description={
              always
                ? t("notif.securityAlways")
                : list.map((e) => t(`notif.kind.${e.kind}`)).join(", ")
            }
            control={
              <SettingState tone={on > 0 ? "ok" : "off"}>
                {t("notif.ofTotal", { on, total: list.length })}
              </SettingState>
            }
          >
            {list.map((e) => (
              <Checkbox
                key={e.kind}
                disabled={!active || always}
                checked={e.channels[id]}
                onChange={(ev) => save.mutate({ kind: e.kind, on: ev.currentTarget.checked })}
                label={t(`notif.kind.${e.kind}`)}
                description={t(`notif.kindHint.${e.kind}`)}
              />
            ))}
          </SettingRow>
        );
      })}
    </>
  );
}

/** Settings › Notifications › a channel: how it is connected, what it gets. */
export function NotificationChannelSection() {
  const { t } = useTranslation();
  // The demo has only the bell, on a route of its own.
  const { channel = "inapp" } = useParams();
  const meta = CHANNELS.find((c) => c.id === channel && shown(c.id));
  // Hooks run before the redirect, so give them a channel either way.
  const id = meta?.id ?? "inapp";
  const status = useStatus(id);
  if (!meta) return <Navigate to="/settings/notifications" replace />;
  const guide = GUIDE[id];
  return (
    <>
      {id !== "inapp" && (
        <SettingsGroup
          title={t("notif.connection")}
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
          <SettingRow
            icon={meta.icon}
            title={t(`notif.name.${id}`)}
            description={t(`notif.about.${id}`)}
            control={<SettingState tone={tone(status)}>{status.text}</SettingState>}
            defaultOpen
          >
            <Stack gap="sm">
              {id === "push" ? (
                <NotificationsCard />
              ) : (
                addressed(id) && <ChannelSetup channel={id} />
              )}
            </Stack>
          </SettingRow>
        </SettingsGroup>
      )}
      <SettingsGroup
        title={t("notif.whatArrives")}
        hint={id === "inapp" ? t("notif.about.inapp") : t("notif.whatArrivesHint")}
      >
        {/* Push is per device: its events can be chosen before this one is on. */}
        <ChannelEvents id={id} active={status.active || id === "push"} />
      </SettingsGroup>
      <RelatedSettings ids={["notif-timing", "notif-money"]} />
    </>
  );
}
