import { Button, CloseButton, Group, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCircleArrowUp } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

import { sinceNow } from "../../bankSyncNotice";
import { HowToUpdateModal } from "./HowToUpdateModal";
import { useUpdateCard } from "./updateModel";
import classes from "./updates.module.css";

// UpdateCard tells an admin, at the foot of the menu, that a newer CloudBank
// is out (#582), in the slot the new-pages card uses. Closing it hides it
// until the next release (a week, for a nightly).
export function UpdateCard() {
  const { t, i18n } = useTranslation();
  const { status, visible, dismiss } = useUpdateCard();
  const [how, { open, close }] = useDisclosure(false);
  if (!status || !visible) return null;

  const title =
    status.channel === "nightly"
      ? t("updates.cardNightly")
      : t("updates.cardTitle", { version: status.latest });
  return (
    <div className={classes.card} role="region" aria-label={title}>
      <CloseButton
        size="sm"
        className={classes.close}
        onClick={dismiss}
        aria-label={t("updates.dismiss")}
      />
      <Group gap={8} wrap="nowrap" pr={20}>
        <IconCircleArrowUp size={16} style={{ flexShrink: 0 }} />
        <Text fw={600} size="sm">
          {title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mt={4} mb={8}>
        {status.published
          ? t("updates.cardBody", {
              current: status.current,
              when: sinceNow(status.published, i18n.language),
            })
          : t("updates.cardBodyShort", { current: status.current })}
      </Text>
      <Group gap={6} grow wrap="nowrap">
        <Button
          component="a"
          href={status.releaseUrl}
          target="_blank"
          rel="noreferrer"
          size="compact-sm"
          fz={13}
          px={6}
        >
          {t("updates.whatsNew")}
        </Button>
        <Button size="compact-sm" fz={13} px={6} variant="default" onClick={open}>
          {t("updates.how")}
        </Button>
      </Group>
      <HowToUpdateModal status={status} opened={how} onClose={close} />
    </div>
  );
}
