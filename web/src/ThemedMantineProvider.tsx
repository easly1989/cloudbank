import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";

import { useAuth } from "./auth/AuthProvider";
import { buildTheme } from "./theme";

// ThemedMantineProvider builds the Mantine theme from the signed-in user's
// accent-colour preference, so changing the accent in Settings restyles the
// whole app live. AuthProvider is mounted above it (it renders no Mantine UI,
// only context), which lets this read useAuth() without a second query.
export function ThemedMantineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <MantineProvider theme={buildTheme(user?.preferences?.themeAccent)} defaultColorScheme="auto">
      {children}
    </MantineProvider>
  );
}
