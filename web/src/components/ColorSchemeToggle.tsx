import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { t } = useTranslation();

  // Persist the choice as a user setting (server-side) so AppLayout's load
  // effect re-applies the same value instead of resetting it on refresh; guests
  // fall back to Mantine's localStorage persistence.
  const persist = useMutation({
    mutationFn: (theme: string) => updateMe({ theme }),
    onSuccess: (u: User) => qc.setQueryData(["me"], u),
  });

  const dark = colorScheme === "dark";
  const toggle = () => {
    const next = dark ? "light" : "dark";
    setColorScheme(next);
    if (user) persist.mutate(next);
  };

  return (
    <ActionIcon variant="default" size="lg" aria-label={t("actions.toggleTheme")} onClick={toggle}>
      {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}
