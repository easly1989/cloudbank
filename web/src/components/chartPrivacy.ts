import type { EChartsOption } from "echarts";

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});

// Privacy mode (#626): the chart keeps its shapes — bars, lines, slices — and
// loses its figures. A value axis keeps its ticks and grid but its labels turn
// into dots, so the plot neither jumps nor says how much; labels on the series
// and its mark lines go, and so does the tooltip, which is all figures. A
// category axis (months, names) and the legend stay: they are the page's shape.
const MASK = "•••";
// A chart whose categories are payees (`names`) masks its category axis too.
export function applyPrivacy(option: EChartsOption, names = false): EChartsOption {
  const maskAxis = (axis: unknown, defaultType: string): unknown => {
    const one = (a: Dict): Dict => {
      const type = (a.type as string | undefined) ?? defaultType;
      if (type === "time" || (type === "category" && !names)) return a;
      return { ...a, axisLabel: { ...asDict(a.axisLabel), formatter: () => MASK } };
    };
    return Array.isArray(axis) ? axis.map((a) => one(asDict(a))) : one(asDict(axis));
  };
  const quiet = (series: unknown): unknown => {
    const one = (x: Dict): Dict => {
      const out: Dict = { ...x, label: { ...asDict(x.label), show: false } };
      if (x.markLine) {
        out.markLine = { ...asDict(x.markLine), label: { show: false } };
      }
      return out;
    };
    return Array.isArray(series) ? series.map((x) => one(asDict(x))) : one(asDict(series));
  };
  const o = option as unknown as Dict;
  const masked: Dict = { ...o, tooltip: { ...asDict(o.tooltip), show: false } };
  if (o.xAxis) masked.xAxis = maskAxis(o.xAxis, "category");
  if (o.yAxis) masked.yAxis = maskAxis(o.yAxis, "value");
  if (o.series) masked.series = quiet(o.series);
  return masked as unknown as EChartsOption;
}
