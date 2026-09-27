import { notifications } from "@mantine/notifications";
import type { TFunction } from "i18next";

import type { BankSyncResult } from "./api/client";

/**
 * What a manual sync did, said once in the same words wherever it was started:
 * Settings › Bank sync or the register (#504). A partial sync names the
 * accounts that failed and stays up longer, so it can be read.
 */
export function showSyncResult(res: BankSyncResult, t: TFunction) {
  const failed = res.failed ?? 0;
  notifications.show({
    color: failed > 0 ? "orange" : "teal",
    message:
      failed > 0
        ? t("banksync.syncedPartial", {
            imported: res.imported,
            reconciled: res.reconciled,
            warnings: (res.warnings ?? []).join("; "),
          })
        : t("banksync.synced", { imported: res.imported, reconciled: res.reconciled }),
    autoClose: failed > 0 ? 8000 : undefined,
  });
}

/**
 * How long ago an RFC3339 moment was, in the app's language: "2 hours ago",
 * "2 ore fa", "yesterday". Minutes under an hour, hours under a day, days
 * after that.
 */
export function sinceNow(iso: string, lang: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
