import { Button, FileInput, Group, Text } from "@mantine/core";
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
import { notifyError } from "../notifyError";

export function BackupRows() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { currentWallet, setCurrentWalletId } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [file, setFile] = useState<File | null>(null);

  const onError = (err: unknown) => notifyError(err);

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

  // Rows of the Backup card, under the integrity check.
  return (
    <>
      <div className="cb-settings-row">
        <div className="cb-settings-row-text">
          <Text fz="sm" fw={600}>
            {t("backup.title")}
          </Text>
          <Text fz={13} c="dimmed">
            {t("backup.description")}
          </Text>
        </div>
        <Group gap="xs">
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
      </div>

      {/* The demo build restores nothing: a restore makes a wallet from a
          file of any size, past every limit the demo keeps. */}
      {!__DEMO__ && (
        <div className="cb-settings-row">
          <div className="cb-settings-row-text">
            <Text fz="sm" fw={600}>
              {t("backup.restoreLabel")}
            </Text>
            <Text fz={13} c="dimmed">
              {t("backup.restoreHint")}
            </Text>
          </div>
          <Group gap="xs">
            <FileInput
              w={240}
              aria-label={t("backup.restoreLabel")}
              placeholder={t("backup.choosePlaceholder")}
              accept=".json,application/json"
              leftSection={<IconUpload size={16} />}
              value={file}
              onChange={setFile}
              clearable
            />
            <Button disabled={!file} onClick={() => restore.mutate()} loading={restore.isPending}>
              {t("backup.restore")}
            </Button>
          </Group>
        </div>
      )}

      {user?.isAdmin && (
        <div className="cb-settings-row">
          <div className="cb-settings-row-text">
            <Text fz="sm" fw={600}>
              {t("backup.adminLabel")}
            </Text>
            <Text fz={13} c="dimmed">
              {t("backup.hotHint")}
            </Text>
          </div>
          <Button
            variant="default"
            leftSection={<IconDatabaseExport size={16} />}
            onClick={() => downloadDb.mutate()}
            loading={downloadDb.isPending}
          >
            {t("backup.hotDownload")}
          </Button>
        </div>
      )}
    </>
  );
}
