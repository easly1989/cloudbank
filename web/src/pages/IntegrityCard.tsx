import { Alert, Badge, Button, Group, List, Stack, Text } from "@mantine/core";
import { IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { checkIntegrity, fixIntegrity, type IntegrityIssue } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";
import { ErrorMessage } from "../components/ErrorMessage";
import { SettingRow } from "./settings/SettingRow";

export function IntegrityRow() {
  const { t } = useTranslation();
  const { currentWallet } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [issues, setIssues] = useState<IntegrityIssue[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const onError = (err: unknown) => setError(err);

  const run = useMutation({
    mutationFn: () => checkIntegrity(walletId),
    onSuccess: (res) => {
      setError(null);
      setIssues(res.issues);
    },
    onError,
  });

  const fix = useMutation({
    mutationFn: (type: string) => fixIntegrity(walletId, type),
    onSuccess: () => run.mutate(),
    onError,
  });

  // What the check finds opens under its row.
  const found = error != null || issues !== null;
  return (
    <SettingRow
      id="integrity"
      open={found}
      control={
        <Button variant="default" onClick={() => run.mutate()} loading={run.isPending}>
          {t("integrity.run")}
        </Button>
      }
    >
      {found && (
        <Stack gap="sm">
          {error != null && (
            <Alert color="red" icon={<IconAlertTriangle size={16} />}>
              <ErrorMessage error={error} />
            </Alert>
          )}

          {issues !== null && issues.length === 0 && (
            <Alert color="green" icon={<IconCircleCheck size={16} />}>
              {t("integrity.clean")}
            </Alert>
          )}

          {issues && issues.length > 0 && (
            <List spacing="sm">
              {issues.map((issue) => (
                <List.Item key={issue.type} icon={<IconAlertTriangle size={16} color="orange" />}>
                  <Group justify="space-between" wrap="nowrap">
                    <div>
                      <Text size="sm">
                        {t(`integrity.types.${issue.type}`, issue.description)}{" "}
                        <Badge color="orange" size="sm">
                          {issue.count}
                        </Badge>
                      </Text>
                      <Text size="xs" c="dimmed">
                        {issue.suggestion}
                      </Text>
                    </div>
                    {issue.fixable && (
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => fix.mutate(issue.type)}
                        loading={fix.isPending}
                      >
                        {t("integrity.fix")}
                      </Button>
                    )}
                  </Group>
                </List.Item>
              ))}
            </List>
          )}
        </Stack>
      )}
    </SettingRow>
  );
}
