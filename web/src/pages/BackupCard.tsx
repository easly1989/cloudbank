import { Button, Card, Divider, FileInput, Group, Stack, Text, Title } from "@mantine/core";
import { IconDatabaseExport, IconDownload, IconFileExport, IconUpload } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiError,
  downloadHotBackup,
  downloadWalletBackup,
  downloadWalletXHB,
  restoreBackup,
} from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useWallet } from "../wallet/WalletProvider";

export function BackupCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { currentWallet, setCurrentWalletId } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [file, setFile] = useState<File | null>(null);

  const onError = (err: unknown) =>
    notifications.show({
      color: "red",
      message: err instanceof ApiError ? err.message : String(err),
    });

  const download = useMutation({ mutationFn: () => downloadWalletBackup(walletId), onError });
  const downloadXhb = useMutation({ mutationFn: () => downloadWalletXHB(walletId), onError });
  const downloadDb = useMutation({ mutationFn: () => downloadHotBackup(), onError });

  const restore = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError(0, "no file");
      const doc = JSON.parse(await file.text());
      return restoreBackup(doc);
    },
    onSuccess: async (res) => {
      setFile(null);
      await qc.invalidateQueries({ queryKey: ["wallets"] });
      setCurrentWalletId(res.walletId);
      notifications.show({ color: "teal", message: t("backup.restored") });
    },
    onError,
  });

  return (
    <Card withBorder>
      <Stack>
        <Title order={4}>{t("backup.title")}</Title>
        <Text size="sm" c="dimmed">
          {t("backup.description")}
        </Text>
        <Group>
          <Button
            variant="light"
            leftSection={<IconDownload size={16} />}
            onClick={() => download.mutate()}
            loading={download.isPending}
          >
            {t("backup.download")}
          </Button>
          <Button
            variant="light"
            leftSection={<IconFileExport size={16} />}
            onClick={() => downloadXhb.mutate()}
            loading={downloadXhb.isPending}
          >
            {t("backup.downloadXhb")}
          </Button>
        </Group>

        <Divider label={t("backup.restoreLabel")} labelPosition="left" />
        <FileInput
          placeholder={t("backup.choosePlaceholder")}
          accept=".json,application/json"
          leftSection={<IconUpload size={16} />}
          value={file}
          onChange={setFile}
          clearable
        />
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {t("backup.restoreHint")}
          </Text>
          <Button disabled={!file} onClick={() => restore.mutate()} loading={restore.isPending}>
            {t("backup.restore")}
          </Button>
        </Group>

        {user?.isAdmin && (
          <>
            <Divider label={t("backup.adminLabel")} labelPosition="left" />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {t("backup.hotHint")}
              </Text>
              <Button
                variant="default"
                leftSection={<IconDatabaseExport size={16} />}
                onClick={() => downloadDb.mutate()}
                loading={downloadDb.isPending}
              >
                {t("backup.hotDownload")}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}
