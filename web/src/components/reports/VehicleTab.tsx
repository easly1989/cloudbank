import { Anchor, SegmentedControl, Select, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { getVehicleReport, listVehicles } from "../../api/client";
import { categoryColor, useChartColors } from "../../chartPalette";
import { formatMinor, formatNumber } from "../../money";
import { Chart, type ChartHandle } from "../Chart";
import { Figure, Figures } from "./Figures";
import { type ReportContext, csvAmount, shortDay } from "./reportContext";
import classes from "./reports.module.css";

/** Up to this many vehicles are picked with a segmented control, beyond it a select. */
const SEGMENTS = 4;

// Vehicle (#493): the two figures people ask of a car — what it costs a
// kilometre and what it drinks — then consumption fill by fill against the
// average, and the fills themselves.
export function VehicleTab({ ctx }: { ctx: ReportContext }) {
  const { t, i18n } = useTranslation();
  const colors = useChartColors();
  const { walletId, state, set, period, fmt, isPhone, setExport } = ctx;
  const chartRef = useRef<ChartHandle>(null);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", walletId],
    queryFn: () => listVehicles(walletId),
    enabled: walletId > 0,
  });
  const vehicles = useMemo(() => vehiclesQuery.data ?? [], [vehiclesQuery.data]);
  const vehicleId =
    state.vehicle !== null && vehicles.some((v) => v.id === state.vehicle)
      ? state.vehicle
      : (vehicles[0]?.id ?? null);

  const query = useQuery({
    queryKey: ["vehicle", walletId, vehicleId, period.from, period.to],
    queryFn: () => getVehicleReport(walletId, vehicleId!, period.from, period.to),
    enabled: walletId > 0 && vehicleId !== null,
  });
  const report = query.data;
  const num = (v: number, digits = 1) => formatNumber(v, digits, fmt);
  const km = t("reports.unitDistance");
  const l = t("reports.unitVolume");
  const per100 = t("reports.unitConsumption");

  const fills = useMemo(() => report?.entries.filter((e) => e.consumption > 0) ?? [], [report]);
  const option: EChartsOption = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 12, top: 22, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: unknown) => `${num(Number(v) || 0)} ${per100}`,
      },
      xAxis: {
        type: "category",
        data: fills.map((e) => shortDay(e.date, i18n.language)),
        axisTick: { show: false },
        axisLabel: { rotate: 0, hideOverlap: true },
      },
      yAxis: { type: "value", scale: true, axisLabel: { formatter: (v: number) => num(v) } },
      series: [
        {
          // Points joined by a line, not bars: the differences are tenths of a
          // litre, and bars on an axis that does not start at zero would make
          // them look like halves.
          name: per100,
          type: "line",
          symbol: "circle",
          symbolSize: 8,
          data: fills.map((e) => Math.round(e.consumption * 10) / 10),
          lineStyle: { color: categoryColor(colors, 1), width: 2 },
          itemStyle: { color: categoryColor(colors, 1) },
          markLine: report?.avgConsumption
            ? {
                symbol: "none",
                silent: true,
                lineStyle: { color: colors.muted, type: "dashed" },
                label: {
                  formatter: t("reports.fuel.average", { value: num(report.avgConsumption) }),
                  color: colors.muted,
                  position: "insideEndTop",
                },
                data: [{ yAxis: report.avgConsumption }],
              }
            : undefined,
        },
      ],
    }),
    // num reads fmt only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fills, report?.avgConsumption, colors, fmt, t, i18n.language, per100],
  );

  useEffect(() => {
    if (!report) {
      setExport(null);
      return;
    }
    setExport({
      name: `vehicle-${period.from?.slice(0, 7) ?? "all"}`,
      rows: () => [
        [t("transactions.date"), t("reports.meter"), km, l, per100, t("reports.amount")],
        ...report.entries.map((e) => [
          e.date,
          e.meter,
          e.distance,
          e.partial ? "" : e.volume,
          e.consumption ? e.consumption.toFixed(2) : "",
          csvAmount(e.cost, fmt.fracDigits),
        ]),
      ],
      png: fills.length > 0 ? () => chartRef.current?.getPng() : undefined,
    });
    return () => setExport(null);
  }, [report, fills.length, fmt, period.from, setExport, t, km, l, per100]);

  if (vehiclesQuery.data && vehicles.length === 0) {
    return (
      <Text c="dimmed">
        {t("reports.fuel.none")}{" "}
        <Anchor component={Link} to="/vehicles">
          {t("reports.fuel.add")}
        </Anchor>
      </Text>
    );
  }

  const picker =
    vehicles.length <= SEGMENTS ? (
      <SegmentedControl
        aria-label={t("reports.fuel.pick")}
        value={vehicleId === null ? "" : String(vehicleId)}
        onChange={(v) => set({ vehicle: Number(v) })}
        data={vehicles.map((v) => ({ value: String(v.id), label: v.name }))}
      />
    ) : (
      <Select
        aria-label={t("reports.fuel.pick")}
        data={vehicles.map((v) => ({ value: String(v.id), label: v.name }))}
        value={vehicleId === null ? null : String(vehicleId)}
        onChange={(v) => v && set({ vehicle: Number(v) })}
        allowDeselect={false}
        searchable
        w={isPhone ? "100%" : 280}
      />
    );

  const entries = report?.entries ?? [];
  const costPerKm =
    report && report.totalDistance > 0 ? Math.round(report.totalCost / report.totalDistance) : null;

  return (
    <Stack gap="lg">
      {vehicles.length > 1 && <div className={classes.controls}>{picker}</div>}

      {report && entries.length === 0 && <Text c="dimmed">{t("reports.fuel.empty")}</Text>}

      {report && entries.length > 0 && (
        <>
          <Figures>
            <Figure
              big
              testId="vehicle-cost"
              label={t("reports.fuel.costPerKm")}
              value={costPerKm === null ? "—" : formatMinor(costPerKm, fmt)}
              sub={t("reports.fuel.costFor", {
                cost: formatMinor(report.totalCost, fmt),
                distance: `${num(report.totalDistance, 0)} ${km}`,
              })}
            />
            <Figure
              testId="vehicle-consumption"
              label={t("reports.consumption")}
              value={report.avgConsumption ? `${num(report.avgConsumption)} ${per100}` : "—"}
              sub={t("reports.fuel.volumeIn", {
                volume: `${num(report.totalVolume)} ${l}`,
                count: entries.length,
              })}
            />
          </Figures>

          <div className={classes.cols}>
            <div>
              <Text fw={600} size="sm" mb="xs">
                {t("reports.fuel.chartTitle")}
              </Text>
              {fills.length > 0 ? (
                <Chart
                  ref={chartRef}
                  option={option}
                  height={isPhone ? 170 : 200}
                  label={t("reports.fuel.chartTitle")}
                />
              ) : (
                <Text c="dimmed" size="sm">
                  {t("reports.fuel.needTwoFills")}
                </Text>
              )}
            </div>
            <div data-testid="vehicle-fills">
              <div className={`${classes.fill} ${classes.fillHead}`}>
                <span>{t("transactions.date")}</span>
                <span className={classes.wideOnly}>{km}</span>
                <span className={classes.wideOnly}>{l}</span>
                <span className={classes.wideOnly}>{per100}</span>
                <span>{t("reports.amount")}</span>
              </div>
              {[...entries].reverse().map((e) => (
                <div key={e.transactionId} className={classes.fill}>
                  <span>{shortDay(e.date, i18n.language)}</span>
                  <span className={classes.wideOnly}>
                    {e.distance > 0 ? num(e.distance, 0) : "—"}
                  </span>
                  <span className={classes.wideOnly}>
                    {e.partial ? t("reports.partial") : num(e.volume)}
                  </span>
                  <span className={classes.wideOnly}>
                    {e.consumption > 0 ? num(e.consumption) : "—"}
                  </span>
                  <span>{formatMinor(e.cost, fmt)}</span>
                  <span className={classes.fillSummary}>
                    {[
                      e.distance > 0 ? `${num(e.distance, 0)} ${km}` : null,
                      e.partial ? t("reports.partial") : `${num(e.volume)} ${l}`,
                      e.consumption > 0 ? `${num(e.consumption)} ${per100}` : null,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Stack>
  );
}
