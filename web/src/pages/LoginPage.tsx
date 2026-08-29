import {
  Alert,
  Button,
  Card,
  Center,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, isTotpChallenge } from "../api/client";
import { useLogin } from "../auth/AuthProvider";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function LoginPage() {
  const { t } = useTranslation();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // After a correct password, a 2FA account gets a totp challenge; the form then
  // asks for the second factor and resubmits with it.
  const challenged = login.data ? isTotpChallenge(login.data) : false;

  const submit = () => login.mutate({ username, password, totpCode: totpCode.trim() || undefined });

  const error =
    login.error instanceof ApiError
      ? login.error.status === 401
        ? challenged
          ? t("login.invalidCode")
          : t("login.invalid")
        : login.error.message
      : login.error
        ? String(login.error)
        : "";

  return (
    <Center mih="100vh">
      <Card withBorder w={360} p="lg">
        <Stack>
          <Title order={3}>{t("login.title")}</Title>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput
            label={t("login.username")}
            required
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <PasswordInput
            label={t("login.password")}
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {challenged && (
            <>
              <Text size="sm" c="dimmed">
                {t("login.totpHint")}
              </Text>
              <TextInput
                label={t("login.totpCode")}
                required
                autoFocus
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </>
          )}
          <Button
            onClick={submit}
            loading={login.isPending}
            disabled={!username || !password || (challenged && !totpCode)}
          >
            {challenged ? t("login.verify") : t("login.submit")}
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
