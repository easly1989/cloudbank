import { describe, expect, it } from "vitest";

import { selectionFor } from "./rowSelect";

const ref = (v: number | null = null) => ({ current: v });

describe("selectionFor", () => {
  it("ignores a plain click", () => {
    const a = ref(2);
    expect(selectionFor({ shift: false, toggle: false }, 5, a)).toBeNull();
    expect(a.current).toBe(2);
  });

  it("toggles on ctrl and makes the row the anchor", () => {
    const a = ref();
    expect(selectionFor({ shift: false, toggle: true }, 4, a)).toEqual({
      mode: "toggle",
      index: 4,
    });
    expect(a.current).toBe(4);
  });

  it("ranges from the anchor in either direction and keeps it", () => {
    const a = ref(5);
    expect(selectionFor({ shift: true, toggle: false }, 2, a)).toEqual({
      mode: "range",
      from: 2,
      to: 5,
    });
    expect(selectionFor({ shift: true, toggle: false }, 8, a)).toEqual({
      mode: "range",
      from: 5,
      to: 8,
    });
    expect(a.current).toBe(5);
  });

  it("falls back to the cursor, then to the row itself", () => {
    expect(selectionFor({ shift: true, toggle: false }, 3, ref(), 1)).toEqual({
      mode: "range",
      from: 1,
      to: 3,
    });
    expect(selectionFor({ shift: true, toggle: false }, 3, ref())).toEqual({
      mode: "range",
      from: 3,
      to: 3,
    });
  });
});
