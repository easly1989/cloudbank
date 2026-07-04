import { describe, expect, it } from "vitest";

import {
  COLUMNS,
  DEFAULT_WIDGET_TYPES,
  type PlacedWidget,
  WIDGET_SIZES,
  defaultLayout,
  migrateLayout,
  newInstanceId,
} from "./layout";

const kpi = (id: string): PlacedWidget => ({ id, type: "kpi", x: 0, y: 0, w: 3, h: 2 });

describe("defaultLayout", () => {
  it("places the default widget set in order with their default sizes", () => {
    const l = defaultLayout();
    expect(l.version).toBe(2);
    expect(l.widgets.map((w) => w.type)).toEqual(DEFAULT_WIDGET_TYPES);
    for (const w of l.widgets) {
      // A fresh dashboard uses the bare type as the instance id.
      expect(w.id).toBe(w.type);
      expect(w.w).toBe(WIDGET_SIZES[w.type].w);
      expect(w.h).toBe(WIDGET_SIZES[w.type].h);
    }
  });

  it("packs widgets left-to-right, wrapping at the column count", () => {
    const l = defaultLayout(["kpi", "kpi", "kpi", "kpi", "kpi"]); // each 3 wide → 4 per row
    // No placed widget overflows the grid.
    for (const w of l.widgets) expect(w.x + w.w).toBeLessThanOrEqual(COLUMNS);
    // The fifth (3-wide) widget wraps to a new row.
    expect(l.widgets[4].x).toBe(0);
    expect(l.widgets[4].y).toBeGreaterThan(0);
  });
});

describe("migrateLayout", () => {
  // migrateLayout accepts unknown (a raw preferences blob), so the tests pass
  // plain objects — including intentionally-invalid stored widget types.
  it("passes a valid v2 layout through, dropping unknown widget types", () => {
    const l = migrateLayout({
      version: 2,
      widgets: [
        { id: "totals", type: "totals", x: 0, y: 0, w: 12, h: 2 },
        { id: "bogus", type: "bogus", x: 0, y: 2, w: 6, h: 3 },
        { id: "notes", type: "notes", x: 0, y: 5, w: 4, h: 3 },
      ],
    });
    expect(l.version).toBe(2);
    expect(l.widgets.map((w) => w.type)).toEqual(["totals", "notes"]);
  });

  it("falls back to the default layout when a v2 layout has no known widgets", () => {
    const l = migrateLayout({
      version: 2,
      widgets: [{ id: "x", type: "x", x: 0, y: 0, w: 1, h: 1 }],
    });
    expect(l.widgets.map((w) => w.type)).toEqual(DEFAULT_WIDGET_TYPES);
  });

  it("migrates a legacy { order, hidden, spans } layout to v2", () => {
    const l = migrateLayout({
      order: ["accounts", "totals"],
      hidden: ["spending"],
      spans: { accounts: "half", totals: "third" },
    });
    expect(l.version).toBe(2);
    const types = l.widgets.map((w) => w.type);
    // The hidden widget is dropped; the explicit order comes first, then the
    // remaining defaults are back-filled.
    expect(types).not.toContain("spending");
    expect(types[0]).toBe("accounts");
    expect(types[1]).toBe("totals");
    for (const t of DEFAULT_WIDGET_TYPES) {
      if (t !== "spending") expect(types).toContain(t);
    }
    // The legacy span maps to a column width (half → 6, third → 4).
    expect(l.widgets.find((w) => w.type === "accounts")?.w).toBe(6);
    expect(l.widgets.find((w) => w.type === "totals")?.w).toBe(4);
    // Every id is unique and no widget overflows the grid.
    expect(new Set(l.widgets.map((w) => w.id)).size).toBe(l.widgets.length);
    for (const w of l.widgets) expect(w.x + w.w).toBeLessThanOrEqual(COLUMNS);
  });

  it("returns the default layout for undefined or garbage input", () => {
    expect(migrateLayout(undefined).widgets.map((w) => w.type)).toEqual(DEFAULT_WIDGET_TYPES);
    expect(migrateLayout({ nonsense: true }).widgets.map((w) => w.type)).toEqual(
      DEFAULT_WIDGET_TYPES,
    );
  });
});

describe("newInstanceId", () => {
  it("uses the bare type name when it is free", () => {
    expect(newInstanceId("kpi", [])).toBe("kpi");
  });

  it("suffixes -2, -3, … for further instances of the same type", () => {
    const existing: PlacedWidget[] = [kpi("kpi")];
    expect(newInstanceId("kpi", existing)).toBe("kpi-2");
    existing.push(kpi("kpi-2"));
    expect(newInstanceId("kpi", existing)).toBe("kpi-3");
    existing.push(kpi("kpi-3"));
    expect(newInstanceId("kpi", existing)).toBe("kpi-4");
  });
});
