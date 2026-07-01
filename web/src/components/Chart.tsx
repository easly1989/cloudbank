import { useComputedColorScheme } from "@mantine/core";
import type { EChartsOption } from "echarts";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from "echarts/components";
// `use` is aliased so eslint's react-hooks rule doesn't mistake it for React's
// `use` hook (ECharts' use() registers renderers/charts at module load).
import { init, use as registerEcharts, type ECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

// Register only the chart types and components the app actually uses, so the
// bundle doesn't pull in the whole ECharts library (saves ~400 KB of JS versus
// `import * as echarts from "echarts"`). Add to this list if a new chart/feature
// is introduced.
registerEcharts([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export interface ChartHandle {
  /** Returns the chart as a PNG data URL (for export). */
  getPng: () => string | undefined;
}

type Dict = Record<string, unknown>;
const asDict = (v: unknown): Dict => (v && typeof v === "object" ? (v as Dict) : {});

// Inject theme-aware text/line colours so legends, axis labels and the default
// text are readable in both light and dark mode. Only components actually
// present in the option are touched (so a pie chart never grows phantom axes),
// and any explicit per-option colour wins over the default.
function applyChartTheme(option: EChartsOption, dark: boolean): EChartsOption {
  const text = dark ? "#c1c2c5" : "#373a40";
  const line = dark ? "#373a40" : "#ced4da";
  const split = dark ? "#2c2e33" : "#e9ecef";

  const themeLegend = (legend: unknown): unknown => {
    const one = (l: Dict): Dict => ({ ...l, textStyle: { color: text, ...asDict(l.textStyle) } });
    return Array.isArray(legend) ? legend.map((l) => one(asDict(l))) : one(asDict(legend));
  };
  const themeAxis = (axis: unknown): unknown => {
    const one = (a: Dict): Dict => ({
      ...a,
      axisLabel: { color: text, ...asDict(a.axisLabel) },
      axisLine: {
        ...asDict(a.axisLine),
        lineStyle: { color: line, ...asDict(asDict(a.axisLine).lineStyle) },
      },
      splitLine: {
        ...asDict(a.splitLine),
        lineStyle: { color: split, ...asDict(asDict(a.splitLine).lineStyle) },
      },
    });
    return Array.isArray(axis) ? axis.map((a) => one(asDict(a))) : one(asDict(axis));
  };

  const o = option as unknown as Dict;
  const themed: Dict = { ...o, textStyle: { color: text, ...asDict(o.textStyle) } };
  if (o.legend) themed.legend = themeLegend(o.legend);
  if (o.xAxis) themed.xAxis = themeAxis(o.xAxis);
  if (o.yAxis) themed.yAxis = themeAxis(o.yAxis);
  return themed as unknown as EChartsOption;
}

// Chart is a thin React wrapper over ECharts: it renders an option, resizes with
// its container, forwards slice/bar clicks, and exposes a PNG data URL.
export const Chart = forwardRef<
  ChartHandle,
  {
    option: EChartsOption;
    height?: number;
    onSelect?: (key: string) => void;
  }
>(function Chart({ option, height = 360, onSelect }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  // Re-theme (and re-render) the option whenever the colour scheme changes so
  // chart text stays readable after a light/dark toggle.
  const scheme = useComputedColorScheme("light");
  const themed = useMemo(() => applyChartTheme(option, scheme === "dark"), [option, scheme]);

  useImperativeHandle(ref, () => ({
    getPng: () => chart.current?.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }),
  }));

  useEffect(() => {
    if (!el.current) return;
    const instance = init(el.current);
    chart.current = instance;
    const onResize = () => instance.resize();
    window.addEventListener("resize", onResize);
    // ECharts measures its container at init; if the container isn't laid out
    // yet (e.g. a chart inside a freshly-opened tab) it renders 0×0 and stays
    // blank until a window resize. A ResizeObserver re-fits the chart whenever
    // the container's own size changes, so it appears as soon as it's visible.
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => instance.resize());
      ro.observe(el.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    instance.setOption(themed, true);
    instance.resize();
    instance.off("click");
    if (onSelect) {
      instance.on("click", (params: { data?: unknown }) => {
        const d = params.data as { key?: string } | undefined;
        if (d?.key != null) onSelect(d.key);
      });
    }
  }, [themed, onSelect]);

  return <div ref={el} style={{ width: "100%", height }} />;
});
