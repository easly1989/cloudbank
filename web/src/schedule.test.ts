import { afterEach, describe, expect, it, vi } from "vitest";

import { localScheduleToUtc, utcScheduleToLocal } from "./schedule";

// Pin the browser offset. getTimezoneOffset() returns (UTC - local) in minutes:
// UTC+2 → -120, UTC-5 → +300.
function withOffset(offsetMinutes: number) {
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(offsetMinutes);
}

afterEach(() => vi.restoreAllMocks());

describe("schedule tz conversion", () => {
  it("no offset is identity", () => {
    withOffset(0);
    expect(localScheduleToUtc(3, [1, 3, 5])).toEqual({ hour: 3, days: [1, 3, 5] });
    expect(utcScheduleToLocal(3, [1, 3, 5])).toEqual({ hour: 3, days: [1, 3, 5] });
  });

  it("UTC+2: local 03:00 → 01:00 UTC, same day", () => {
    withOffset(-120);
    expect(localScheduleToUtc(3, [1, 2])).toEqual({ hour: 1, days: [1, 2] });
  });

  it("UTC+2: local 01:00 Monday → 23:00 UTC Sunday (day shifts back)", () => {
    withOffset(-120);
    // Monday=1 → Sunday=0
    expect(localScheduleToUtc(1, [1])).toEqual({ hour: 23, days: [0] });
  });

  it("UTC-5: local 22:00 Saturday → 03:00 UTC Sunday (day shifts forward)", () => {
    withOffset(300);
    // Saturday=6 → Sunday=0
    expect(localScheduleToUtc(22, [6])).toEqual({ hour: 3, days: [0] });
  });

  it("round-trips local → UTC → local", () => {
    withOffset(-120);
    const utc = localScheduleToUtc(1, [0, 1, 6]);
    expect(utcScheduleToLocal(utc.hour, utc.days)).toEqual({ hour: 1, days: [0, 1, 6] });
  });
});
