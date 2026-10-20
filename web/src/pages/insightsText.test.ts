import { describe, expect, it } from "vitest";

import { paragraphs, splitAmounts } from "./insightsText";

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
