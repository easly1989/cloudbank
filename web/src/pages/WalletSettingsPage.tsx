import { Alert, Button, Card, Divider, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCoin, IconTags, IconUserDollar } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ApiError, deleteWallet, updateWallet } from "../api/client";
import { useWallet } from "../wallet/WalletProvider";
import { BackupCard } from "./BackupCard";
import { IntegrityCard } from "./IntegrityCard";

export function WalletSettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { currentWallet } = useWallet();
  const [title, setTitle] = useState(currentWallet?.title ?? "");
  const [ownerName, setOwnerName] = useState(currentWallet?.ownerName ?? "");
  const [confirm, setConfirm] = useState("");

  const notifyError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const rename = useMutation({
    mutationFn: () => updateWallet(currentWallet!.id, { title, ownerName }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["wallets"] });
      notifications.show({ color: "green", message: t("wallet.saved") });
    },
    onError: notifyError,
  });

  const remove = useMutation({
    mutationFn: () => deleteWallet(currentWallet!.id),
    onSuccess: async () => {
      localStorage.removeItem("cb.currentWalletId");
      await qc.invalidateQueries({ queryKey: ["wallets"] });
    },
    onError: notifyError,
  });

  if (!currentWallet) return null;
  const isOwner = currentWallet.role === "owner";
  const canDelete = confirm === currentWallet.title;

  return (
    <Stack maw={520}>
      <Card withBorder>
        <Stack>
          <TextInput
            label={t("wallet.title")}
            value={title}
            disabled={!isOwner}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          <TextInput
            label={t("wallet.ownerName")}
            value={ownerName}
            disabled={!isOwner}
            onChange={(e) => setOwnerName(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              onClick={() => rename.mutate()}
              loading={rename.isPending}
              disabled={!isOwner || !title}
            >
              {t("wallet.save")}
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">
          {t("settings.manage")}
        </Title>
        <Group>
          <Button
            variant="light"
            leftSection={<IconTags size={16} />}
            onClick={() => navigate("/categories")}
          >
            {t("categories.title")}
          </Button>
          <Button
            variant="light"
            leftSection={<IconUserDollar size={16} />}
            onClick={() => navigate("/payees")}
          >
            {t("payees.title")}
          </Button>
          <Button
            variant="light"
            leftSection={<IconCoin size={16} />}
            onClick={() => navigate("/currencies")}
          >
            {t("currencies.title")}
          </Button>
        </Group>
      </Card>

      <IntegrityCard />
      <BackupCard />

      {isOwner && (
        <Card withBorder>
          <Stack>
            <div>
              <Title order={4} c="red">
                {t("wallet.dangerZone")}
              </Title>
              <Text size="sm" c="dimmed">
                {t("wallet.deleteWarning")}
              </Text>
            </div>
            <Alert color="red" variant="light">
              {t("wallet.deleteConfirmLabel", { title: currentWallet.title })}
            </Alert>
            <TextInput value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
            <Group justify="flex-end">
              <Button
                color="red"
                onClick={() => remove.mutate()}
                loading={remove.isPending}
                disabled={!canDelete}
              >
                {t("wallet.delete")}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Divider />
    </Stack>
  );
}
