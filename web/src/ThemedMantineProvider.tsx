import { MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "./auth/AuthProvider";
import { buildTheme } from "./theme";

// Persist the light/dark choice in localStorage so it survives a refresh even
// for signed-out users (logged-in users also persist it server-side).
const colorSchemeManager = localStorageColorSchemeManager({ key: "cb-color-scheme" });

// ThemedMantineProvider builds the Mantine theme from the signed-in user's
// accent-colour preference, so changing the accent in Settings restyles the
// whole app live. AuthProvider is mounted above it (it renders no Mantine UI,
// only context), which lets this read useAuth() without a second query.
export function ThemedMantineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useTranslation();
  return (
    <MantineProvider
      theme={buildTheme(user?.preferences?.themeAccent, t("common.close"))}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      {children}
    </MantineProvider>
  );
}
