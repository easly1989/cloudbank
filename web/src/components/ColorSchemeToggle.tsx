import { ActionIcon, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { updateMe, type User } from "../api/client";
import { useAuth } from "../auth/AuthProvider";

export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  // Resolve the *effective* scheme: useMantineColorScheme().colorScheme can be
  // "auto", which made the first click compute the value already on screen (a
  // no-op). useComputedColorScheme resolves "auto" to "light"/"dark" so the
  // toggle always flips.
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
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

  const dark = computed === "dark";
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
