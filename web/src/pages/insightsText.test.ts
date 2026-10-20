import { describe, expect, it } from "vitest";

import { paragraphs, periodLabel, splitAmounts } from "./insightsText";

// A t that shows its key and values, so the test reads what reaches it.
const t = ((key: string, v?: Record<string, string>) =>
  `${key}:${Object.values(v ?? {}).join("|")}`) as unknown as Parameters<typeof periodLabel>[2];

describe("periodLabel", () => {
  it("names a month, a week and a year", () => {
    expect(periodLabel({ kind: "monthly", period: "2026-09" }, "en", t)).toBe("September 2026");
    expect(periodLabel({ kind: "yearly", period: "2025" }, "en", t)).toBe("insights.year:2025");
  });

  // ICU puts thin spaces round the dash, hence \s.
  it("names the month once for a week inside it, twice across two", () => {
    expect(periodLabel({ kind: "weekly", period: "2026-10-12" }, "en", t)).toMatch(
      /^insights\.week:October 12\s–\s18$/,
    );
    expect(periodLabel({ kind: "weekly", period: "2026-09-28" }, "en", t)).toMatch(
      /^insights\.week:September 28\s–\sOctober 4$/,
    );
  });
});

const amounts = (text: string) => splitAmounts(text).filter((_, i) => i % 2 === 1);

describe("splitAmounts", () => {
  it("finds the amounts however the model writes them", () => {
    expect(amounts("In 2540.00 EUR, out 1.842,10 € and € 12.40; net -697.90.")).toEqual([
      "2540.00 EUR",
      "1.842,10 €",
      "€ 12.40",
      "-697.90",
    ]);
  });

  it("leaves years, percentages and counts alone", () => {
    expect(amounts("In 2026 groceries fell 9% over 3 months.")).toEqual([]);
  });

  it("keeps the text whole", () => {
    const text = "You kept 697,90 € aside.";
    expect(splitAmounts(text).join("")).toBe(text);
  });
});

describe("paragraphs", () => {
  it("splits on blank lines and drops empty ones", () => {
    expect(paragraphs("One.\n\nTwo.\n  \n\nThree.\n")).toEqual(["One.", "Two.", "Three.\n"]);
  });
});
