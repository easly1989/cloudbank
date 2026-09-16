import { describe, expect, it } from "vitest";

import { msUntilLocalMidnight, toCivilDate, todayCivil } from "./civilDate";

describe("toCivilDate", () => {
  it("renders the local calendar day, not the UTC one", () => {
    // Local midnight on the 1st. East of UTC this instant is still the previous
    // month in UTC, which is exactly what toISOString() used to return.
    expect(toCivilDate(new Date(2026, 2, 1, 0, 0, 0))).toBe("2026-03-01");
    // Local end of day. West of UTC this instant is already tomorrow in UTC.
    expect(toCivilDate(new Date(2026, 2, 31, 23, 59, 59))).toBe("2026-03-31");
  });

  it("zero-pads month and day", () => {
    expect(toCivilDate(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });

  it("agrees with the local calendar across a DST change", () => {
    // In zones that observe it, the European DST jump lands in this window.
    expect(toCivilDate(new Date(2026, 2, 29, 12, 0, 0))).toBe("2026-03-29");
    expect(toCivilDate(new Date(2026, 9, 25, 12, 0, 0))).toBe("2026-10-25");
  });
});

describe("todayCivil", () => {
  it("matches the local calendar fields of the current date", () => {
    const now = new Date();
    expect(todayCivil()).toBe(toCivilDate(now));
  });
});

describe("msUntilLocalMidnight", () => {
  it("counts to the next local midnight, not the next UTC one", () => {
    const now = new Date(2026, 2, 15, 23, 0, 0); // 23:00 local
    // One hour to midnight, plus the one-second cushion.
    expect(msUntilLocalMidnight(now)).toBe(60 * 60 * 1000 + 1000);
  });

  it("is always positive and within a day", () => {
    const ms = msUntilLocalMidnight(new Date(2026, 6, 1, 0, 0, 0));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
  });
});
