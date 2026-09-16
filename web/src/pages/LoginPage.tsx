import {
  Alert,
  Button,
  Card,
  Center,
  Divider,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconLogin2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, getAuthConfig, isTotpChallenge } from "../api/client";
import { useLogin } from "../auth/AuthProvider";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

export function LoginPage() {
  const { t } = useTranslation();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // Available login methods (whether OIDC/SSO is configured) and any SSO error
  // handed back by the callback redirect (?sso_error=...).
  const authConfig = useQuery({
    queryKey: ["authConfig"],
    queryFn: getAuthConfig,
    staleTime: Infinity,
  });
  const sso = authConfig.data?.oidc;
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");

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
          {ssoError && <Alert color="red">{t("login.ssoFailed")}</Alert>}
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
          {sso?.enabled && !challenged && (
            <>
              <Divider label={t("login.or")} labelPosition="center" />
              <Button
                variant="default"
                component="a"
                href="/api/v1/auth/oidc/start"
                leftSection={<IconLogin2 size={16} />}
              >
                {t("login.ssoSignIn", { provider: sso.name })}
              </Button>
            </>
          )}
          <Stack gap="xs" align="center">
            <LanguageSwitcher />
            <ColorSchemeToggle />
          </Stack>
        </Stack>
      </Card>
    </Center>
  );
}
