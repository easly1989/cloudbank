import { describe, expect, it } from "vitest";

import { selectionFor } from "./rowSelect";

const ref = (v: number | null = null) => ({ current: v });
const plain = { shift: false, toggle: false };
const shift = { shift: true, toggle: false };
const ctrl = { shift: false, toggle: true };
// Row ids, in the order shown.
const ids = [10, 20, 30, 40, 50, 60, 70, 80, 90];

describe("selectionFor", () => {
  it("ignores a plain click", () => {
    const a = ref(30);
    expect(selectionFor(plain, ids, 5, a)).toBeNull();
    expect(a.current).toBe(30);
  });

  it("toggles on ctrl and makes the row the anchor", () => {
    const a = ref();
    expect(selectionFor(ctrl, ids, 4, a)).toEqual({ mode: "toggle", index: 4 });
    expect(a.current).toBe(50);
  });

  it("ranges from the anchor in either direction and keeps it", () => {
    const a = ref(60);
    expect(selectionFor(shift, ids, 2, a)).toEqual({ mode: "range", from: 2, to: 5 });
    expect(selectionFor(shift, ids, 8, a)).toEqual({ mode: "range", from: 5, to: 8 });
    expect(a.current).toBe(60);
  });

  it("finds the anchor again when the order changes", () => {
    const a = ref(30);
    expect(selectionFor(shift, [90, 80, 70, 60, 50, 40, 30], 1, a)).toEqual({
      mode: "range",
      from: 1,
      to: 6,
    });
  });

  it("falls back to the cursor when the anchor is gone, then to the row itself", () => {
    expect(selectionFor(shift, ids, 3, ref(999), 20)).toEqual({ mode: "range", from: 1, to: 3 });
    expect(selectionFor(shift, ids, 3, ref(999), 888)).toEqual({ mode: "range", from: 3, to: 3 });
    expect(selectionFor(shift, ids, 3, ref())).toEqual({ mode: "range", from: 3, to: 3 });
  });

  it("selects nothing and sets no anchor on a row that cannot be picked", () => {
    const a = ref(10);
    expect(selectionFor(ctrl, ids, 4, a, null, (n) => n !== 4)).toBeNull();
    expect(selectionFor(shift, ids, 4, a, null, (n) => n !== 4)).toBeNull();
    expect(a.current).toBe(10);
  });
});
