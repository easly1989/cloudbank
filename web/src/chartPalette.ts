// The colours of every chart, in one place.
//
// Charts used Mantine's pastels, a set chosen for nothing in particular: the
// reports and the dashboard each kept their own copy, and neither matched the
// style tile. The tile gives four category colours; three more are drawn to sit
// beside them (same weight, told apart by hue), and "Other" is a neutral grey so
// it never reads as one more category. Each has a lifted twin for the dark
// scheme, where the light ones fall under the contrast floor.
//
// Money in and out keep their own fixed pair (see amountTone.ts) and attention
// its amber: none of them is ever a category colour, so a red bar always means
// money going out and never "the fifth category".
import { useComputedColorScheme } from "@mantine/core";

const CATEGORY_LIGHT = [
  "#C2762B",
  "#4B63C7",
  "#2F7D63",
  "#8A5BA8",
  "#B0476B",
  "#3E8CA3",
  "#7C7A2A",
];
const CATEGORY_DARK = ["#D8955A", "#7C8FDD", "#55A98A", "#B08CCC", "#D97A98", "#6DB3C6", "#B2AE5C"];

export interface ChartColors {
  /** Category colours, in rank order; cycle with categoryColor. */
  categories: string[];
  /** The "Other" row: the rest, lumped together. */
  other: string;
  /** Money in and money out: the same pair as every amount (amountTone.ts). */
  in: string;
  out: string;
  /** Something that needs attention: over a minimum, more than last time. */
  attention: string;
  /** Lines and marks that are neither: a total, the average, today. */
  ink: string;
  muted: string;
  /** The empty part of a bar's track, and the gridlines. */
  track: string;
  /** The card behind a chart, for a hollow marker. */
  surface: string;
}

const LIGHT: ChartColors = {
  categories: CATEGORY_LIGHT,
  other: "#8B93A1",
  in: "#10704E",
  out: "#A33529",
  attention: "#9A6100",
  ink: "#12161D",
  muted: "#67707E",
  track: "#EEF1F5",
  surface: "#FFFFFF",
};

const DARK: ChartColors = {
  categories: CATEGORY_DARK,
  other: "#8B93A1",
  in: "#4FC095",
  out: "#F08B7E",
  attention: "#E0A43C",
  ink: "#E8EDF5",
  muted: "#A6B0BF",
  track: "#1F2733",
  surface: "#161C25",
};

export function chartColors(dark: boolean): ChartColors {
  return dark ? DARK : LIGHT;
}

/** The i-th category colour, cycling when there are more rows than colours. */
export function categoryColor(colors: ChartColors, i: number): string {
  return colors.categories[i % colors.categories.length];
}

/** The chart colours for the scheme on screen. */
export function useChartColors(): ChartColors {
  const scheme = useComputedColorScheme("light");
  return chartColors(scheme === "dark");
}
