import { Button, createTheme, Modal, Table, type MantineColorsTuple } from "@mantine/core";

// CloudBank's own blue, as a Mantine tuple. Shade 6 (#2457D6) is the accent the
// app ships with; the rest ramp either side of it for hovers, tints and dark
// mode. It replaces Mantine's built-in blue so the app does not look like every
// other Mantine app, and replaces teal as the default so that green is free to
// mean one thing only — money coming in. See amountTone.ts.
const cloudbank: MantineColorsTuple = [
  "#eef3fe",
  "#dce6fc",
  "#b7cbf8",
  "#90aff4",
  "#6e96f0",
  "#5886ee",
  "#2457d6",
  "#1f4cbe",
  "#1a41a4",
  "#13358a",
];

// The accent (Mantine primary) colours offered in Settings. CloudBank's own blue
// leads; the rest are built-in Mantine palettes, so each works in both schemes.
//
// Green is deliberately absent. An accent that matches the colour of income
// would make "you can click this" and "you earned this" look identical.
export const ACCENT_COLORS = [
  "cloudbank",
  "teal",
  "cyan",
  "indigo",
  "violet",
  "grape",
  "pink",
  "orange",
] as const;

const DEFAULT_ACCENT = "cloudbank";

// buildTheme creates the Mantine theme using the user's chosen accent colour
// (falling back to the default). Called from main with the signed-in user's
// preference so changing the accent updates the whole app live.
export function buildTheme(accent?: string) {
  const primaryColor =
    accent && (ACCENT_COLORS as readonly string[]).includes(accent) ? accent : DEFAULT_ACCENT;
  return createTheme({
    primaryColor,
    colors: { cloudbank },
    // Public Sans holds up at thirteen pixels in a dense table, which is where
    // this app actually lives. IBM Plex Mono is reserved for figures: every
    // digit the same width, so a column of amounts lines up on the decimal.
    fontFamily: '"Public Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    fontFamilyMonospace: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    headings: {
      fontFamily: '"Public Sans", system-ui, sans-serif',
      fontWeight: "700",
      sizes: {
        h1: { fontSize: "1.875rem", lineHeight: "1.2" },
        h2: { fontSize: "1.5rem", lineHeight: "1.25" },
        h3: { fontSize: "1.125rem", lineHeight: "1.3" },
        h4: { fontSize: "0.9375rem", lineHeight: "1.4" },
      },
    },
    defaultRadius: "md",
    components: {
      // One consistent, scannable table baseline app-wide: compact rows and a
      // quiet hover highlight so a row is easy to follow across its columns.
      Table: Table.extend({
        defaultProps: { verticalSpacing: "xs", horizontalSpacing: "md", highlightOnHover: true },
      }),
      // Buttons ease between colours rather than snapping, which is what makes
      // the interface feel like it is answering you. Kept short enough that
      // nobody waits for it, and dropped entirely for reduced-motion (app.css).
      Button: Button.extend({
        defaultProps: { radius: "md" },
        classNames: { root: "cb-transition" },
      }),
      // Modals are for decisions you cannot undo, so they are deliberately
      // plain: centred, no scroll-jump, and never used for entering data (that
      // is what the side sheet is for).
      Modal: Modal.extend({
        defaultProps: { centered: true, radius: "md", overlayProps: { blur: 2 } },
      }),
    },
  });
}

// Base theme (default accent), kept for any context without a user preference.
export const theme = buildTheme();
