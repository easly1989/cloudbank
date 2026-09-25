import { Alert, Button, Card, Center, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError, startDemo } from "../api/client";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

/**
 * The demo build's front door, in place of the login form: one button that
 * makes an account of the reader's own. What happens to it is said here,
 * before anything is made, and again inside (DemoChrome).
 */
export function DemoLoginPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: () => startDemo(i18n.language),
    onSuccess: (user) => qc.setQueryData(["me"], user),
  });

  const error = !start.error
    ? ""
    : start.error instanceof ApiError && start.error.status === 429
      ? t("demo.tooMany")
      : start.error instanceof ApiError && start.error.code === "demo_full"
        ? t("demo.full")
        : t("demo.failed");

  return (
    <Center component="main" mih="100vh" px="md">
      <Card withBorder w={400} maw="100%" p="lg" className="cb-demo-login">
        <Stack>
          <Title order={1} fz="h3">
            {t("demo.loginTitle")}
          </Title>
          <Text>{t("demo.loginBody")}</Text>
          <Text size="sm" c="dimmed">
            {t("demo.loginResets")}
          </Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Button size="md" onClick={() => start.mutate()} loading={start.isPending}>
            {t("demo.start")}
          </Button>
          <Stack gap="xs" align="center">
            <LanguageSwitcher />
            <ColorSchemeToggle />
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}
