import { Card, Group, Switch, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBell } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { currentPushSubscription, disablePush, enablePush, pushSupported } from "../push";

// NotificationsCard lets the user opt this browser in or out of Web Push
// notifications (currently: bills reminders).
export function NotificationsCard() {
  const { t } = useTranslation();
  const [supported] = useState(() => pushSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(
    typeof Notification !== "undefined" && Notification.permission === "denied",
  );

  useEffect(() => {
    if (!supported) return;
    void currentPushSubscription().then((s) => setSubscribed(!!s));
  }, [supported]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) {
        const res = await enablePush();
        if (res === "granted") {
          setSubscribed(true);
        } else if (res === "denied") {
          setDenied(true);
          notifications.show({ color: "red", message: t("notif.denied") });
        }
      } else {
        await disablePush();
        setSubscribed(false);
      }
    } catch (err) {
      notifications.show({ color: "red", message: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <IconBell size={18} />
            <Title order={5}>{t("notif.title")}</Title>
          </Group>
          <Text size="sm" c="dimmed" maw={560} mt={4}>
            {t("notif.hint")}
          </Text>
          {denied && (
            <Text size="xs" c="red" mt={4}>
              {t("notif.blocked")}
            </Text>
          )}
          {!supported && (
            <Text size="xs" c="dimmed" mt={4}>
              {t("notif.unsupported")}
            </Text>
          )}
        </div>
        <Switch
          checked={subscribed}
          disabled={!supported || busy || denied}
          onChange={(e) => toggle(e.currentTarget.checked)}
          aria-label={t("notif.title")}
        />
      </Group>
    </Card>
  );
}
