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
import { IconLogin2 } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuthConfig, useSetup } from "../auth/AuthProvider";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ErrorMessage } from "../components/ErrorMessage";

// First-run wizard: creates the administrator account when no users exist yet.
// A server that signs in through SSO only (#620) is set up by its first SSO
// sign-in instead, so the page is that button.
export function SetupPage() {
  const authConfig = useAuthConfig();
  const sso = authConfig.data?.oidc;
  if (authConfig.data?.passwordLogin === false && sso?.enabled) {
    return <SsoSetup provider={sso.name} />;
  }
  return <PasswordSetup />;
}

function SsoSetup({ provider }: { provider: string }) {
  const { t } = useTranslation();
  // A refused first sign-in comes back here with the error the callback
  // handed the login page; "account" means CB_OIDC_ADMIN_EMAIL is someone else.
  const ssoError = new URLSearchParams(window.location.search).get("sso_error");
  return (
    <Center mih="100vh">
      <Card withBorder w={400} p="lg">
        <Stack>
          <div>
            <Title order={3}>{t("setup.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("setup.ssoSubtitle")}
            </Text>
          </div>
          {ssoError && (
            <Alert color="red">
              {ssoError === "unavailable"
                ? t("login.ssoUnavailable", { provider })
                : ssoError === "account"
                  ? t("setup.ssoReserved")
                  : t("login.ssoFailedOnly", { provider })}
            </Alert>
          )}
          <Button
            component="a"
            href="/api/v1/auth/oidc/start"
            leftSection={<IconLogin2 size={16} />}
          >
            {t("login.ssoSignIn", { provider })}
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

function PasswordSetup() {
  const { t } = useTranslation();
  const setup = useSetup();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");

  const submit = () => {
    setLocalError("");
    if (password.length < 8) {
      setLocalError(t("setup.passwordTooShort"));
      return;
    }
    if (password !== confirm) {
      setLocalError(t("setup.passwordMismatch"));
      return;
    }
    setup.mutate({ username, email, password });
  };

  const serverError = setup.error ? <ErrorMessage error={setup.error} /> : null;
  const error = localError || serverError;

  return (
    <Center mih="100vh">
      <Card withBorder w={400} p="lg">
        <Stack>
          <div>
            <Title order={3}>{t("setup.title")}</Title>
            <Text c="dimmed" size="sm">
              {t("setup.subtitle")}
            </Text>
          </div>
          {error && <Alert color="red">{error}</Alert>}
          <TextInput
            label={t("setup.username")}
            required
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
          <TextInput
            label={t("setup.email")}
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label={t("setup.password")}
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <PasswordInput
            label={t("setup.confirmPassword")}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
          />
          <Button onClick={submit} loading={setup.isPending} disabled={!username || !password}>
            {t("setup.submit")}
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
