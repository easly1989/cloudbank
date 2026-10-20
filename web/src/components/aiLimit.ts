import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AI_SETTINGS_KEY, type AISettings } from "../api/ai";
import { ApiError } from "../api/core";
import { useConfirm } from "./confirmContext";

/**
 * Runs a call to the AI that the user asked for (#696). When this month's
 * limit is reached the server says so instead of calling; the user is asked,
 * and on a yes the call goes again with their confirmation. A no resolves to
 * null. The settings are refreshed after, so the counter moves.
 */
export function useAskPastLimit() {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { t, i18n } = useTranslation();
  return async function run<T>(call: (confirmed: boolean) => Promise<T>): Promise<T | null> {
    try {
      return await call(false);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === "ai_limit")) throw err;
      const limit = qc.getQueryData<AISettings>(AI_SETTINGS_KEY)?.monthlyLimit ?? 0;
      const n = new Date();
      const reset = new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
      const ok = await confirm({
        title: t("ai.limit.title"),
        body: t("ai.limit.body", { count: limit, date: reset }),
        confirmLabel: t("ai.limit.go"),
        cancelLabel: t("ai.limit.stop"),
      });
      return ok ? await call(true) : null;
    } finally {
      void qc.invalidateQueries({ queryKey: AI_SETTINGS_KEY });
    }
  };
}
