import * as echarts from "echarts";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export interface ChartHandle {
  /** Returns the chart as a PNG data URL (for export). */
  getPng: () => string | undefined;
}

// Chart is a thin React wrapper over ECharts: it renders an option, resizes with
// its container, forwards slice/bar clicks, and exposes a PNG data URL.
export const Chart = forwardRef<
  ChartHandle,
  {
    option: echarts.EChartsOption;
    height?: number;
    onSelect?: (key: string) => void;
  }
>(function Chart({ option, height = 360, onSelect }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useImperativeHandle(ref, () => ({
    getPng: () => chart.current?.getDataURL({ pixelRatio: 2, backgroundColor: "#fff" }),
  }));

  useEffect(() => {
    if (!el.current) return;
    const instance = echarts.init(el.current);
    chart.current = instance;
    const onResize = () => instance.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    instance.setOption(option, true);
    instance.off("click");
    if (onSelect) {
      instance.on("click", (params: { data?: unknown }) => {
        const d = params.data as { key?: string } | undefined;
        if (d?.key != null) onSelect(d.key);
      });
    }
  }, [option, onSelect]);

  return <div ref={el} style={{ width: "100%", height }} />;
});
