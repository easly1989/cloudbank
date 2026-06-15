import { Button, Card, Center, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

// Placeholder login screen. The auth flow is implemented in the auth/admin
// milestone (feat/auth-admin); this establishes the route and layout.
export function LoginPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Center mih="100vh">
      <Card withBorder w={360} p="lg">
        <Stack>
          <Title order={3}>{t("login.title")}</Title>
          <TextInput
            label={t("login.username")}
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
          <PasswordInput
            label={t("login.password")}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Button disabled>{t("login.submit")}</Button>
          <Stack gap="xs" align="center">
            <LanguageSwitcher />
            <ColorSchemeToggle />
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}
