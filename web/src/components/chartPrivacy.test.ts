import type { EChartsOption } from "echarts";
import { describe, expect, it } from "vitest";

import { applyPrivacy } from "./chartPrivacy";

type Dict = Record<string, unknown>;
const label = (axis: unknown) => (axis as Dict).axisLabel as Dict | undefined;

describe("applyPrivacy (#626)", () => {
  const option = {
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: ["Jan", "Feb"] },
    yAxis: { type: "value", axisLabel: { color: "#000" } },
    series: [
      { type: "bar", data: [1, 2], label: { show: true }, markLine: { data: [{ yAxis: 1 }] } },
    ],
  } as EChartsOption;
  const masked = applyPrivacy(option) as Dict;

  it("drops the tooltip and the labels on the series and its mark lines", () => {
    expect((masked.tooltip as Dict).show).toBe(false);
    const s = (masked.series as Dict[])[0];
    expect((s.label as Dict).show).toBe(false);
    expect(((s.markLine as Dict).label as Dict).show).toBe(false);
    expect((s.data as number[]).length).toBe(2);
  });

  it("masks the value axis, keeps its styling, and leaves the months alone", () => {
    const y = label(masked.yAxis)!;
    expect((y.formatter as () => string)()).toBe("•••");
    expect(y.color).toBe("#000");
    expect(label(masked.xAxis)).toBeUndefined();
  });

  it("masks a category axis of payees too", () => {
    const named = applyPrivacy(option, true) as Dict;
    expect((label(named.xAxis)!.formatter as () => string)()).toBe("•••");
  });

  it("leaves the option it was given untouched", () => {
    expect((option.tooltip as Dict).show).toBeUndefined();
  });
});
