import { Anchor, Button, Code, CopyButton, Group, Modal, Stack, Text } from "@mantine/core";
import { Trans, useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { UpdateStatus } from "../../api/client";
import { UPGRADE_URL } from "../../aboutLinks";
import classes from "./updates.module.css";

const IMAGE = "ghcr.io/easly1989/cloudbank";

function Command({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <div className={classes.command}>
      <Code block className={classes.code}>
        {text}
      </Code>
      <CopyButton value={text}>
        {({ copied, copy }) => (
          <Button size="compact-xs" variant="subtle" color="gray" onClick={copy}>
            {copied ? t("updates.copied") : t("updates.copy")}
          </Button>
        )}
      </CopyButton>
    </div>
  );
}

/**
 * How to update the server (#582). CloudBank cannot do it itself: replacing
 * its own container would need the Docker socket, which holds the whole host.
 * So this says what to run, with a backup first.
 */
export function HowToUpdateModal({
  status,
  opened,
  onClose,
}: {
  status: UpdateStatus;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The tag the channel's newest build is published under.
  const tag = status.channel === "nightly" ? "latest" : "main";
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("updates.howTitle", { version: status.latest })}
      size={540}
      centered
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("updates.howIntro")}
        </Text>
        <Text fw={600} size="sm">
          {t("updates.howBackup")}
        </Text>
        <Text size="sm" c="dimmed">
          <Trans
            i18nKey="updates.howBackupBody"
            components={{ a: <Anchor component={Link} to="/settings/data" onClick={onClose} /> }}
          />
        </Text>
        <Text fw={600} size="sm">
          {t("updates.howCompose")}
        </Text>
        <Command text={"docker compose pull\ndocker compose up -d"} />
        <Text fw={600} size="sm">
          {t("updates.howRun")}
        </Text>
        <Command text={`docker pull ${IMAGE}:${tag}`} />
        <Text size="sm" c="dimmed">
          {t("updates.howRunAfter")}
        </Text>
        {status.channel === "stable" && (
          <Text size="sm" c="dimmed">
            {t("updates.howPinned", { current: status.current, version: status.latest })}
          </Text>
        )}
        <Group justify="space-between" mt="xs">
          <Anchor href={UPGRADE_URL} target="_blank" rel="noreferrer" size="sm">
            {t("updates.guide")}
          </Anchor>
          <Button variant="default" onClick={onClose}>
            {t("common.close")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
