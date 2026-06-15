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

import { ApiError } from "../api/client";
import { useSetup } from "../auth/AuthProvider";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

// First-run wizard: creates the administrator account when no users exist yet.
export function SetupPage() {
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

  const serverError =
    setup.error instanceof ApiError ? setup.error.message : setup.error ? String(setup.error) : "";
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
