import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { saveMe, type User } from "../../api/client";

/** A backup older than this many days is worth a reminder. */
export const BACKUP_STALE_DAYS = 30;

/**
 * Days since the reader last downloaded a backup of the wallet from here, or
 * null when never. The server keeps no date of its own, so this is what the
 * reader's preferences remember (#800).
 */
export function backupAgeDays(user: User | null | undefined, walletId: number, now = Date.now()) {
  const at = user?.preferences?.lastBackupAt?.[String(walletId)];
  if (!at) return null;
  return Math.max(0, Math.floor((now - Date.parse(at)) / 86_400_000));
}

export const backupStale = (days: number | null) => days === null || days > BACKUP_STALE_DAYS;

export function backupAgeText(t: TFunction, days: number | null) {
  if (days === null) return t("settings.backupNever");
  if (days === 0) return t("settings.backupToday");
  return t("settings.backupDays", { count: days });
}

/** Remember that a backup of the wallet was just downloaded. */
export function recordBackup(qc: QueryClient, walletId: number) {
  const me = qc.getQueryData<User>(["me"]);
  const prev = me?.preferences?.lastBackupAt ?? {};
  return saveMe(qc, {
    preferences: { lastBackupAt: { ...prev, [String(walletId)]: new Date().toISOString() } },
  }).catch(() => undefined);
}
