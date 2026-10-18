import { describe, expect, it } from "vitest";

import { bellSection, bellWhen } from "./notificationTime";

const now = new Date(2026, 9, 18, 15, 0); // a Sunday afternoon, local time
const at = (d: number, h = 9) => new Date(2026, 9, d, h, 30).toISOString();

describe("bellSection", () => {
  it("splits today, the last week and earlier", () => {
    expect(bellSection(at(18, 0), now)).toBe("today");
    expect(bellSection(at(17, 23), now)).toBe("week");
    expect(bellSection(at(12), now)).toBe("week");
    expect(bellSection(at(11, 23), now)).toBe("earlier");
  });
});

describe("bellWhen", () => {
  it("says the hour today, yesterday, the weekday, then the date", () => {
    expect(bellWhen(at(18), now, "en-GB", "yesterday")).toBe("09:30");
    expect(bellWhen(at(17), now, "en-GB", "yesterday")).toBe("yesterday");
    expect(bellWhen(at(13), now, "en-GB", "yesterday")).toBe("Tue");
    expect(bellWhen(at(2), now, "en-GB", "yesterday")).toBe("2 Oct");
  });
});
