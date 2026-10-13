import { describe, expect, it } from "vitest";

import { dayInWeek, weekdayNames } from "./week";

// The heatmap and the schedules calendar both draw their week from these: a
// language that starts on Sunday gets Sunday in the first column (#608).
describe("the week's first day", () => {
  it("names the days from Monday or from Sunday", () => {
    expect(weekdayNames("en", "short", 1)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    expect(weekdayNames("en", "short", 0)[0]).toBe("Sun");
    expect(weekdayNames("en", "short", 0)[6]).toBe("Sat");
  });

  it("places the 1st of the month after the right number of blanks", () => {
    // 1 September 2026 is a Tuesday.
    const tuesday = new Date(2026, 8, 1).getDay();
    expect(dayInWeek(tuesday, 1)).toBe(1);
    expect(dayInWeek(tuesday, 0)).toBe(2);
    // A Sunday is the last day of a Monday week and the first of a Sunday one.
    expect(dayInWeek(0, 1)).toBe(6);
    expect(dayInWeek(0, 0)).toBe(0);
  });
});
