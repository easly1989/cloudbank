import { describe, expect, it } from "vitest";

import type { VehicleEntry, VehicleReport } from "../../api/client";
import { daysBetween, lastFill, lineOf, reportLink } from "./vehicleList";

const car = { id: 7, name: "Family car", plate: "AB 123 CD", notes: "" };

const entry = (date: string, meter: number, cost: number, partial = false): VehicleEntry => ({
  transactionId: meter,
  date,
  meter,
  distance: 0,
  volume: partial ? 0 : 30,
  price: 1.8,
  cost,
  partial,
  consumption: 0,
});

const report = (entries: VehicleEntry[], extra: Partial<VehicleReport> = {}): VehicleReport => ({
  entries,
  totalDistance: 0,
  totalVolume: 0,
  totalCost: entries.reduce((s, e) => s + e.cost, 0),
  avgConsumption: 0,
  currency: null,
  ...extra,
});

describe("lineOf", () => {
  it("reads the year's figures and the fills ever linked", () => {
    const old = [entry("2025-01-07", 30000, 5000), entry("2025-01-21", 30600, 5200)];
    const year = [
      entry("2026-08-07", 41000, 5500),
      entry("2026-08-21", 41600, 6000, true),
      entry("2026-09-07", 42100, 5800),
      entry("2026-09-21", 42700, 5900),
      entry("2026-09-28", 43000, 3000),
    ];
    const l = lineOf(
      car,
      report(year, { totalDistance: 2000, avgConsumption: 5.24 }),
      report([...old, ...year]),
    );
    expect(l.fills).toBe(5);
    expect(l.cost).toBe(26200);
    expect(l.distance).toBe(2000);
    expect(l.perKm).toBe(13); // 26,200 cents over 2,000 km: 13.1
    expect(l.consumption).toBe(5.24);
    expect(l.linked).toBe(7);
    expect(l.recent.map((e) => e.date)).toEqual([
      "2026-09-28",
      "2026-09-21",
      "2026-09-07",
      "2026-08-21",
      "2026-08-07",
    ]);
    expect(lastFill(l)?.meter).toBe(43000);
  });

  it("has no cost a kilometre without a distance, and nothing before the reports load", () => {
    const one = lineOf(car, report([entry("2026-09-07", 42100, 5800)]), undefined);
    expect(one.perKm).toBeNull();
    expect(one.linked).toBe(0);
    const none = lineOf(car, undefined, undefined);
    expect(none).toMatchObject({ fills: 0, cost: 0, perKm: null, linked: 0, recent: [] });
    expect(lastFill(none)).toBeNull();
  });
});

describe("helpers", () => {
  it("counts days between civil dates, across a month and a clock change", () => {
    expect(daysBetween("2026-09-21", "2026-10-01")).toBe(10);
    expect(daysBetween("2026-10-20", "2026-10-30")).toBe(10);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
  });

  it("links to the Reports page's vehicle tab", () => {
    expect(reportLink(7)).toBe("/reports?tab=vehicle&v=7");
  });
});
