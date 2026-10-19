import { notifications, type NotificationsProps } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { ApiError } from "../api/client";
import { ErrorMessage } from "./ErrorMessage";

/**
 * Creating from a sheet (#531): the new entry joins the list at once, so it
 * can be selected, and the list is then refetched. When the server already
 * has the name — typed in another case than the list shows, or added
 * elsewhere meanwhile — the existing one is picked and the reader told.
 */
export function useCreateFromSheet(walletId: number, toastAt: NotificationsProps["position"]) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return async <T extends { id: number; name: string }>(
    key: "categories" | "payees",
    make: () => Promise<T>,
    existing: (list: T[]) => T | undefined,
  ): Promise<string | null> => {
    try {
      const made = await make();
      queryClient.setQueryData<T[]>([key, walletId], (old) => [...(old ?? []), made]);
      void queryClient.invalidateQueries({ queryKey: [key, walletId] });
      return String(made.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "duplicate") {
        await queryClient.refetchQueries({ queryKey: [key, walletId] });
        const found = existing(queryClient.getQueryData<T[]>([key, walletId]) ?? []);
        if (found) {
          notifications.show({
            position: toastAt,
            color: "gray",
            message: t("transactions.alreadyExists", { name: found.name }),
          });
          return String(found.id);
        }
      }
      notifications.show({
        position: toastAt,
        color: "red",
        message: <ErrorMessage error={err} />,
      });
      return null;
    }
  };
}
