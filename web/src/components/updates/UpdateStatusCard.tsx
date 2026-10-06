import { Anchor, Button, Group, Switch, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCircleArrowUp, IconCircleCheck } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError, checkForUpdates, setUpdateCheck, type UpdateStatus } from "../../api/client";
import { sinceNow } from "../../bankSyncNotice";
import { HowToUpdateModal } from "./HowToUpdateModal";
import { useUpdateStatus } from "./updateModel";
import classes from "./updates.module.css";

/**
 * Settings › About, for an admin (#582): whether a newer CloudBank is out,
 * and the switch for the daily check. It is where the state stays once the
 * sidebar card is closed.
 */
export function UpdateStatusCard() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: st } = useUpdateStatus();
  const [how, { open, close }] = useDisclosure(false);
  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });
  const store = (next: UpdateStatus) => qc.setQueryData(["updates"], next);
  const toggle = useMutation({ mutationFn: setUpdateCheck, onSuccess: store, onError });
  const check = useMutation({ mutationFn: checkForUpdates, onSuccess: store, onError });
  if (!st) return null;

  const checking = st.enabled && st.allowed && st.channel !== "";
  const when = (iso?: string) => (iso ? sinceNow(iso, i18n.language) : "");

  let head: React.ReactNode;
  if (!st.allowed) {
    head = <Text size="sm">{t("updates.offByServer")}</Text>;
  } else if (st.channel === "") {
    head = <Text size="sm">{t("updates.localBuild")}</Text>;
  } else if (!st.enabled) {
    head = <Text size="sm">{t("updates.offByAdmin")}</Text>;
  } else if (st.available) {
    head = (
      <>
        <div>
          <Group gap={8} wrap="nowrap">
            <IconCircleArrowUp size={16} />
            <Text fw={600}>
              {st.channel === "nightly"
                ? t("updates.availableNightly")
                : t("updates.available", { version: st.latest })}
            </Text>
          </Group>
          <Text size="sm" c="dimmed">
            {st.published ? `${t("updates.released", { when: when(st.published) })} · ` : ""}
            <Anchor href={st.releaseUrl} target="_blank" rel="noreferrer" size="sm">
              {t("updates.whatsNew")}
            </Anchor>
          </Text>
        </div>
        <Button size="xs" onClick={open}>
          {t("updates.how")}
        </Button>
      </>
    );
  } else {
    head = (
      <>
        <div>
          <Group gap={8} wrap="nowrap">
            {!st.error && <IconCircleCheck size={16} />}
            <Text fw={600}>{st.error ? t("updates.noAnswer") : t("updates.upToDate")}</Text>
          </Group>
          {st.error && (
            <Text size="sm" c="dimmed">
              {st.error}
            </Text>
          )}
        </div>
        <Button
          size="xs"
          variant="default"
          loading={check.isPending}
          onClick={() => check.mutate()}
        >
          {t("updates.checkNow")}
        </Button>
      </>
    );
  }

  return (
    <div className={classes.status}>
      <div className={classes.statusRow}>{head}</div>
      {st.allowed && st.channel !== "" && (
        <div className={classes.statusRow}>
          <div>
            <Text size="sm" fw={500}>
              {t("updates.switch")}
            </Text>
            <Text size="sm" c="dimmed">
              {t("updates.switchHint")}
              {checking && st.checkedAt
                ? ` ${t("updates.checked", { when: when(st.checkedAt) })}`
                : ""}
            </Text>
          </div>
          <Switch
            checked={st.enabled}
            disabled={toggle.isPending}
            onChange={(e) => toggle.mutate(e.currentTarget.checked)}
            aria-label={t("updates.switch")}
          />
        </div>
      )}
      {st.available && <HowToUpdateModal status={st} opened={how} onClose={close} />}
    </div>
  );
}
