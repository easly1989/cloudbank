import { Card, Divider, Group, SegmentedControl, Select, Switch, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import {
  getNotificationPreferences,
  getNotificationSettings,
  NOTIFICATION_PREFERENCES_KEY,
  NOTIFICATION_SETTINGS_KEY,
  setNotificationDigest,
  setNotificationSettings,
  type NotificationKind,
  type NotificationPreference,
  type NotificationSettings,
} from "../../api/client";
import { notifyError } from "../../notifyError";
import classes from "./NotificationsPages.module.css";
import { RelatedSettings, SettingRow, SettingsGroup } from "./SettingRow";

// Settings › Notifications › Timing (#692): when notifications reach the
// reader outside the app. The bell is always at once; push, email and chat
// follow the daily digest and the quiet hours.

const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

/** The settings, saved field by field. */
function useSettings() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: NOTIFICATION_SETTINGS_KEY,
    queryFn: getNotificationSettings,
  });
  const save = useMutation({
    mutationFn: setNotificationSettings,
    onSuccess: (s) => qc.setQueryData(NOTIFICATION_SETTINGS_KEY, s),
    onError: notifyError,
  });
  return { settings: data, save: (s: Partial<NotificationSettings>) => save.mutate(s) };
}

/** The zone's name in the reader's language, e.g. "Central European Time". */
function zoneName(zone: string, lang: string): string {
  try {
    const part = new Intl.DateTimeFormat(lang, {
      timeZone: zone || "UTC",
      timeZoneName: "longGeneric",
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? zone;
  } catch {
    return zone || "UTC";
  }
}

function TimeSelect({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      data={TIMES}
      value={value}
      onChange={(v) => v && onChange(v)}
      w={116}
      allowDeselect={false}
      classNames={{ input: classes.timeInput }}
    />
  );
}

/** The overview's row: how the timing stands, one click away. */
export function TimingRow() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { data } = useQuery({
    queryKey: NOTIFICATION_PREFERENCES_KEY,
    queryFn: getNotificationPreferences,
  });
  const collected = (data?.events ?? []).filter((e) => e.digest).length;
  const status = settings
    ? [
        t("notif.timing.rowDigest", { time: settings.digestAt }),
        t("notif.timing.rowEvents", { count: collected }),
        settings.quietHours
          ? t("notif.timing.rowQuietOn", { from: settings.quietFrom, to: settings.quietTo })
          : t("notif.timing.rowQuietOff"),
      ].join(", ")
    : "";
  return <SettingRow id="notif-timing" description={status || undefined} />;
}

/** The digest time, the quiet hours, and how long a review waits. */
function WhenRows() {
  const { t, i18n } = useTranslation();
  const { settings, save } = useSettings();
  if (!settings) return null;
  return (
    <>
      <SettingRow
        id="digest"
        description={t("notif.timing.digestHint", {
          zone: zoneName(settings.timezone, i18n.language),
        })}
        control={
          <TimeSelect
            value={settings.digestAt}
            label={t("notif.timing.digestAt")}
            onChange={(digestAt) => save({ digestAt })}
          />
        }
      />
      <SettingRow
        id="quiet-hours"
        description={settings.quietHours ? t("notif.timing.quietOn") : t("notif.timing.quietOff")}
        open={settings.quietHours}
        control={
          <Switch
            aria-label={t("notif.timing.quiet")}
            checked={settings.quietHours}
            onChange={(e) => save({ quietHours: e.currentTarget.checked })}
          />
        }
      >
        <Group gap="xs" wrap="wrap">
          <Text fz={13}>{t("notif.timing.from")}</Text>
          <TimeSelect
            value={settings.quietFrom}
            label={t("notif.timing.fromLabel")}
            onChange={(quietFrom) => save({ quietFrom })}
          />
          <Text fz={13}>{t("notif.timing.to")}</Text>
          <TimeSelect
            value={settings.quietTo}
            label={t("notif.timing.toLabel")}
            onChange={(quietTo) => save({ quietTo })}
          />
        </Group>
      </SettingRow>
      {/* One wait for every channel (#800): it was on each channel's page. */}
      <SettingRow
        id="review-days"
        control={
          <Select
            aria-label={t("notif.timing.reviewDays")}
            w={140}
            data={[1, 3, 7, 14].map((n) => ({
              value: String(n),
              label: t("notif.timing.days", { count: n }),
            }))}
            value={String(settings.reviewDays)}
            onChange={(v) =>
              v && save({ reviewDays: Number(v) as NotificationSettings["reviewDays"] })
            }
            allowDeselect={false}
          />
        }
      />
    </>
  );
}

/** Every event, at once or in the digest. */
function ModeList() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const phone = useMediaQuery("(max-width: 47.99em)") ?? false;
  const { data } = useQuery({
    queryKey: NOTIFICATION_PREFERENCES_KEY,
    queryFn: getNotificationPreferences,
  });
  const save = useMutation({
    mutationFn: (v: { kind: NotificationKind; digest: boolean }) =>
      setNotificationDigest(v.kind, v.digest),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: NOTIFICATION_PREFERENCES_KEY });
      qc.setQueryData<{ events: NotificationPreference[] }>(
        NOTIFICATION_PREFERENCES_KEY,
        (old) =>
          old && {
            events: old.events.map((e) => (e.kind === v.kind ? { ...e, digest: v.digest } : e)),
          },
      );
    },
    onError: notifyError,
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATION_PREFERENCES_KEY }),
  });
  const events = data?.events ?? [];
  const groups = [...new Set(events.map((e) => e.group))];
  return (
    <Card withBorder p={0} pb="xs">
      {groups.map((g, i) => (
        <Fragment key={g}>
          {i > 0 && <Divider mt="xs" />}
          <Text fz={13} fw={600} px="md" pt="sm" pb={4}>
            {t(`notif.group.${g}`)}
          </Text>
          {events
            .filter((e) => e.group === g)
            .map((e) => {
              const label = t(`notif.kind.${e.kind}`);
              return (
                <Group
                  key={e.kind}
                  justify="space-between"
                  wrap={phone ? "wrap" : "nowrap"}
                  px="md"
                  py={6}
                  gap={phone ? 4 : "md"}
                >
                  <Text fz={14} style={{ minWidth: 0, flex: phone ? "1 0 100%" : undefined }}>
                    {label}
                  </Text>
                  {g === "security" || g === "summaries" ? (
                    <Text fz={13} c="dimmed">
                      {g === "security" ? t("notif.timing.always") : t("notif.timing.atDigest")}
                    </Text>
                  ) : (
                    <SegmentedControl
                      size="xs"
                      aria-label={label}
                      value={e.digest ? "digest" : "now"}
                      onChange={(v) => save.mutate({ kind: e.kind, digest: v === "digest" })}
                      data={[
                        { value: "now", label: t("notif.timing.now") },
                        { value: "digest", label: t("notif.timing.inDigest") },
                      ]}
                    />
                  )}
                </Group>
              );
            })}
        </Fragment>
      ))}
    </Card>
  );
}

/** The page of its own, under Settings › Notifications. */
export function NotificationTimingSection() {
  const { t } = useTranslation();
  return (
    <>
      <SettingsGroup title={t("notif.timing.when")} hint={t("notif.timing.whenHint")}>
        <WhenRows />
      </SettingsGroup>
      <SettingsGroup title={t("notif.timing.modes")} hint={t("notif.timing.modesHint")}>
        <ModeList />
      </SettingsGroup>
      <RelatedSettings ids={["notif-money", "notif-inapp"]} />
    </>
  );
}
