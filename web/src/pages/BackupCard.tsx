import { Button, FileInput, Group } from "@mantine/core";
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
import { useWallet } from "../wallet/WalletProvider";
import { notifyError } from "../notifyError";
import { SettingRow } from "./settings/SettingRow";
import { recordBackup } from "./settings/backupAge";

/** Wallet › Backup and integrity: download a copy, or restore one. */
export function BackupRows() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { currentWallet, setCurrentWalletId } = useWallet();
  const walletId = currentWallet?.id ?? 0;
  const [file, setFile] = useState<File | null>(null);

  const onError = (err: unknown) => notifyError(err);
  const saved = () => void recordBackup(qc, walletId);

  const download = useMutation({
    mutationFn: () => downloadWalletBackup(walletId),
    onSuccess: saved,
    onError,
  });
  // Only the JSON copy counts as a backup: an .xhb export cannot be restored.
  const downloadXhb = useMutation({ mutationFn: () => downloadWalletXHB(walletId), onError });

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
    <>
      <SettingRow
        id="wallet-backup"
        control={
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconDownload size={16} />}
              onClick={() => download.mutate()}
              loading={download.isPending}
            >
              {t("backup.download")}
            </Button>
            <Button
              variant="default"
              leftSection={<IconFileExport size={16} />}
              onClick={() => downloadXhb.mutate()}
              loading={downloadXhb.isPending}
            >
              {t("backup.downloadXhb")}
            </Button>
          </Group>
        }
      />

      {/* The demo build restores nothing: a restore makes a wallet from a
          file of any size, past every limit the demo keeps. */}
      {!__DEMO__ && (
        <SettingRow
          id="restore"
          control={
            <Group gap="xs">
              <FileInput
                w={240}
                maw="100%"
                aria-label={t("backup.choosePlaceholder")}
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
          }
        />
      )}
    </>
  );
}

/** Administration: the whole database, every wallet and user (#800). */
export function HotBackupRow() {
  const { t } = useTranslation();
  const downloadDb = useMutation({ mutationFn: () => downloadHotBackup(), onError: notifyError });
  return (
    <SettingRow
      id="database"
      control={
        <Button
          variant="default"
          leftSection={<IconDatabaseExport size={16} />}
          onClick={() => downloadDb.mutate()}
          loading={downloadDb.isPending}
        >
          {t("settings.download")}
        </Button>
      }
    />
  );
}
