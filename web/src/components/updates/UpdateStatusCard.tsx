import { Anchor, Button, Switch } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { checkForUpdates, setUpdateCheck, type UpdateStatus } from "../../api/client";
import { sinceNow } from "../../bankSyncNotice";
import { SettingRow, SettingState } from "../../pages/settings/SettingRow";
import { HowToUpdateModal } from "./HowToUpdateModal";
import { useUpdateStatus } from "./updateModel";
import { notifyError } from "../../notifyError";

/**
 * Settings › Administration (#582, #800): whether a newer CloudBank is out,
 * and the switch for the daily check, as two rows. It is where the state stays
 * once the sidebar card is closed.
 */
export function UpdateStatusCard() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data: st } = useUpdateStatus();
  const [how, { open, close }] = useDisclosure(false);
  const onError = (err: unknown) => notifyError(err);
  const store = (next: UpdateStatus) => qc.setQueryData(["updates"], next);
  const toggle = useMutation({ mutationFn: setUpdateCheck, onSuccess: store, onError });
  const check = useMutation({ mutationFn: checkForUpdates, onSuccess: store, onError });
  if (!st) return null;

  const checking = st.enabled && st.allowed && st.channel !== "";
  const when = (iso?: string) => (iso ? sinceNow(iso, i18n.language) : "");

  let description: React.ReactNode;
  let control: React.ReactNode = null;
  if (!st.allowed) {
    description = t("updates.offByServer");
  } else if (st.channel === "") {
    description = t("updates.localBuild");
  } else if (!st.enabled) {
    description = t("updates.offByAdmin");
  } else if (st.available) {
    description = (
      <>
        {st.published ? `${t("updates.released", { when: when(st.published) })} · ` : ""}
        <Anchor href={st.releaseUrl} target="_blank" rel="noreferrer" fz={12}>
          {t("updates.whatsNew")}
        </Anchor>
      </>
    );
    control = (
      <>
        <SettingState tone="warn">
          {st.channel === "nightly"
            ? t("updates.availableNightly")
            : t("updates.available", { version: st.latest })}
        </SettingState>
        <Button onClick={open}>{t("updates.how")}</Button>
      </>
    );
  } else {
    description =
      st.error ??
      (checking && st.checkedAt ? t("updates.checked", { when: when(st.checkedAt) }) : "");
    control = (
      <>
        <SettingState tone={st.error ? "error" : "ok"}>
          {st.error ? t("updates.noAnswer") : t("updates.upToDate")}
        </SettingState>
        <Button variant="default" loading={check.isPending} onClick={() => check.mutate()}>
          {t("updates.checkNow")}
        </Button>
      </>
    );
  }

  return (
    <>
      <SettingRow id="updates" description={description} control={control} />
      {st.allowed && st.channel !== "" && (
        <SettingRow
          id="update-check"
          control={
            <Switch
              checked={st.enabled}
              disabled={toggle.isPending}
              onChange={(e) => toggle.mutate(e.currentTarget.checked)}
              aria-label={t("updates.switch")}
            />
          }
        />
      )}
      {st.available && <HowToUpdateModal status={st} opened={how} onClose={close} />}
    </>
  );
}
