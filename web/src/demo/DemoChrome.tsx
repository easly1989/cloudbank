import { Anchor, Box, Button, Group, List, Modal, Stack, Text } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

/**
 * What the demo build shows on every screen: a band at the top saying the data
 * is made up and when it goes, and the notice that says it at length. The
 * notice opens by itself the first time; the band's link opens it again.
 *
 * The resets are said three times (the front door, the notice, the band)
 * because the one that surprises people, the redeploy, can come at any hour.
 */
export function DemoChrome() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [asked, setAsked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const seen = useMutation({
    mutationFn: () => {
      const latest = qc.getQueryData<User>(["me"])?.preferences ?? user?.preferences ?? {};
      return updateMe({ preferences: { ...latest, demoNoticeSeen: true } });
    },
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const firstTime = !user?.preferences?.demoNoticeSeen && !dismissed;
  const opened = asked || firstTime;
  const close = () => {
    setAsked(false);
    if (firstTime) {
      setDismissed(true);
      seen.mutate();
    }
  };

  return (
    <>
      <Box className="cb-demo-banner" role="note" data-demo-banner>
        <Group gap="xs" wrap="wrap" justify="space-between">
          <Text fz="sm" style={{ flex: "1 1 20rem", minWidth: 0 }}>
            <Text span fw={600} mr="xs">
              {t("demo.bannerLabel")}
            </Text>
            {t("demo.banner")}
          </Text>
          <Anchor
            component="button"
            type="button"
            fz="sm"
            className="cb-demo-banner-link"
            onClick={() => setAsked(true)}
          >
            {t("demo.whatsDifferent")}
          </Anchor>
        </Group>
      </Box>
      <Modal
        opened={opened}
        onClose={close}
        title={t("demo.noticeTitle")}
        size="lg"
        centered
        data-demo-notice
      >
        <Stack>
          <List spacing="sm">
            {(["Fake", "Yours", "Reset", "Off"] as const).map((k) => (
              <List.Item key={k}>
                <Text span fw={600}>
                  {t(`demo.notice${k}Lead`)}
                </Text>{" "}
                {t(`demo.notice${k}`)}
              </List.Item>
            ))}
          </List>
          <Group justify="flex-end">
            <Button onClick={close} data-autofocus>
              {t("demo.gotIt")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
