import {
  Badge,
  Button,
  createTheme,
  defaultVariantColorsResolver,
  Drawer,
  Modal,
  Table,
  type MantineColorsTuple,
  type VariantColorsResolver,
} from "@mantine/core";

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

// A destructive action, filled. Mantine fills `color="red"` with red.6, #fa5252,
// and white on that reads 3.28:1 — under the 4.5:1 floor, on the one button that
// throws work away. The confirmation board fills it with the expense colour
// instead (#a33529, --cb-negative in app.css): 6.9:1, and the same red the app
// already uses for "this costs you". It is dark enough to stand on a dark card
// too, so it does not change with the scheme. Every other variant of red — the
// subtle icons, the light alerts — is left to Mantine.
const DANGER_FILL = "#a33529";
const DANGER_FILL_HOVER = "#8c2c22";

const variantColorResolver: VariantColorsResolver = (input) => {
  const colors = defaultVariantColorsResolver(input);
  if (input.variant === "filled" && input.color === "red") {
    return { ...colors, background: DANGER_FILL, hover: DANGER_FILL_HOVER, color: "#fff" };
  }
  return colors;
};

// buildTheme creates the Mantine theme using the user's chosen accent colour
// (falling back to the default). Called from main with the signed-in user's
// preference so changing the accent updates the whole app live.
//
// `closeLabel` is the translated name for the ✕ on every modal and sheet. Mantine
// draws that button as a bare icon with no name, which a screen reader announces
// as just "button" — thirty dialogs' worth of it. The theme is the one place that
// reaches all of them, so the name is passed in here rather than at each call.
export function buildTheme(accent?: string, closeLabel = "Close") {
  const primaryColor =
    accent && (ACCENT_COLORS as readonly string[]).includes(accent) ? accent : DEFAULT_ACCENT;
  const closeButtonProps = { "aria-label": closeLabel };
  return createTheme({
    primaryColor,
    colors: { cloudbank },
    variantColorResolver,
    // Mantine's own transitions — a sheet sliding in, a dialog scaling up, a
    // sidebar group collapsing — run regardless of the reader's motion setting
    // unless this is on. The app's own motion already checks it (motion.ts,
    // app.css); this brings the component library into line.
    respectReducedMotion: true,
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
      // A status is a word, not a shout. Mantine sets badges in caps by
      // default, which turns "overdue" and "paid" into the loudest thing on a
      // row that is mostly numbers you actually came to read. The colour still
      // carries the meaning; the typography no longer competes for it.
      Badge: Badge.extend({
        styles: { label: { textTransform: "none", letterSpacing: "normal" } },
      }),
      // Modals are for decisions you cannot undo, so they are deliberately
      // plain: centred, no scroll-jump, and never used for entering data (that
      // is what the side sheet is for).
      Modal: Modal.extend({
        defaultProps: { centered: true, radius: "md", overlayProps: { blur: 2 }, closeButtonProps },
      }),
      Drawer: Drawer.extend({ defaultProps: { closeButtonProps } }),
    },
  });
}

// Base theme (default accent), kept for any context without a user preference.
export const theme = buildTheme();
