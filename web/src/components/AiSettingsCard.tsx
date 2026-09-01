import {
  Button,
  Card,
  Group,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconSparkles } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, getAISettings, updateAISettings } from "../api/client";

// AiSettingsCard configures the opt-in, bring-your-own-key AI integration. The
// API key is write-only: the server returns only whether one is stored.
export function AiSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["aiSettings"], queryFn: getAISettings });

  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const hasKey = query.data?.hasKey ?? false;

  useEffect(() => {
    if (query.data) {
      setEnabled(query.data.enabled);
      setBaseUrl(query.data.baseUrl);
      setModel(query.data.model);
    }
  }, [query.data]);

  const save = useMutation({
    // Send apiKey only when the user typed a new one, so a blank field keeps
    // the stored key rather than clearing it.
    mutationFn: () =>
      updateAISettings({
        enabled,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey ? { apiKey } : {}),
      }),
    onSuccess: (s) => {
      qc.setQueryData(["aiSettings"], s);
      setApiKey("");
      notifications.show({ color: "teal", message: t("ai.saved") });
    },
    onError: (err: unknown) =>
      notifications.show({
        color: "red",
        message: err instanceof ApiError ? err.message : String(err),
      }),
  });

  return (
    <Card withBorder>
      <Stack>
        <div>
          <Group gap="xs">
            <IconSparkles size={18} />
            <Title order={5}>{t("ai.title")}</Title>
          </Group>
          <Text size="sm" c="dimmed" maw={620} mt={4}>
            {t("ai.hint")}
          </Text>
        </div>
        <Switch
          label={t("ai.enable")}
          checked={enabled}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
        />
        <TextInput
          label={t("ai.baseUrl")}
          description={t("ai.baseUrlHint")}
          placeholder="https://api.openai.com/v1"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.currentTarget.value)}
        />
        <TextInput
          label={t("ai.model")}
          placeholder="gpt-4o-mini"
          value={model}
          onChange={(e) => setModel(e.currentTarget.value)}
        />
        <PasswordInput
          label={t("ai.apiKey")}
          description={hasKey ? t("ai.keySet") : t("ai.keyNotSet")}
          placeholder={hasKey ? "••••••••" : t("ai.apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {t("ai.save")}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
