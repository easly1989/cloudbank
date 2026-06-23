import { createTheme } from "@mantine/core";

// The accent (Mantine primary) colours offered in Settings. All are built-in
// Mantine palette names, so each works in both light and dark schemes.
export const ACCENT_COLORS = [
  "teal",
  "blue",
  "cyan",
  "indigo",
  "violet",
  "grape",
  "pink",
  "red",
  "orange",
  "green",
  "lime",
] as const;

const DEFAULT_ACCENT = "teal";

// buildTheme creates the Mantine theme using the user's chosen accent colour
// (falling back to the default). Called from main with the signed-in user's
// preference so changing the accent updates the whole app live.
export function buildTheme(accent?: string) {
  const primaryColor =
    accent && (ACCENT_COLORS as readonly string[]).includes(accent) ? accent : DEFAULT_ACCENT;
  return createTheme({
    primaryColor,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
    defaultRadius: "md",
  });
}

// Base theme (default accent), kept for any context without a user preference.
export const theme = buildTheme();
