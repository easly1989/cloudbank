import { describe, expect, it } from "vitest";

import { amountColor, negativeOnlyColor } from "./amountTone";

describe("amountColor", () => {
  it("separates money in from money out", () => {
    expect(amountColor(1500)).toBe("var(--cb-positive)");
    expect(amountColor(-1500)).toBe("var(--cb-negative)");
  });

  it("leaves zero uncoloured: nothing moved, so nothing to say", () => {
    expect(amountColor(0)).toBeUndefined();
  });

  // The whole point of the helper: the colour of an amount must not be a Mantine
  // palette name, or it would change when the user picks a different accent.
  it("never returns a palette name", () => {
    for (const v of [1, -1, 0]) {
      const c = amountColor(v);
      expect(c === undefined || c.startsWith("var(--cb-")).toBe(true);
    }
  });
});

describe("negativeOnlyColor", () => {
  it("colours only what is worth spotting", () => {
    expect(negativeOnlyColor(-1)).toBe("var(--cb-negative)");
    expect(negativeOnlyColor(0)).toBeUndefined();
    expect(negativeOnlyColor(9999)).toBeUndefined();
  });
});
