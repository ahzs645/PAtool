import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsCoreOption } from "echarts/core";
import { chartThemes } from "../hooks/useChartTheme";
import { useTheme } from "../hooks/useTheme";
import styles from "./EChart.module.css";

echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  PolarComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer
]);

interface EChartProps {
  option: EChartsCoreOption;
  height?: number;
  zoomable?: boolean;
}

export function EChart({ option, height = 320, zoomable = false }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const { theme } = useTheme();

  const mergedOption = useMemo(() => {
    const ct = chartThemes[theme];
    const themedOption = applyChartTheme(option, ct);
    if (!zoomable) return themedOption;
    return {
      ...themedOption,
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        {
          type: "slider",
          start: 0,
          end: 100,
          height: 20,
          bottom: 4,
          borderColor: ct.axis,
          fillerColor: theme === "dark" ? "rgba(139, 149, 214, 0.22)" : "rgba(71, 84, 184, 0.16)",
          dataBackground: {
            lineStyle: { color: ct.axis },
            areaStyle: { color: theme === "dark" ? "#242c5c" : "#dde2f8" }
          },
          selectedDataBackground: {
            lineStyle: { color: ct.colors[0] },
            areaStyle: { color: theme === "dark" ? "#2a3870" : "#d4defe" }
          },
          handleStyle: { color: ct.tooltipBg, borderColor: ct.colors[0] },
          moveHandleStyle: { color: ct.colors[0] },
          textStyle: { color: ct.text },
          ...(Array.isArray(themedOption.dataZoom) ? themedOption.dataZoom[0] : themedOption.dataZoom)
        }
      ]
    };
  }, [option, theme, zoomable]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const chart = echarts.init(node);
    chartRef.current = chart;

    const ro = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
    ro.observe(node);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;

    chart.setOption(mergedOption, true);
    chart.resize();
  }, [mergedOption]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ height }}
    />
  );
}

type ChartTheme = typeof chartThemes.light;
type AxisOption = Record<string, unknown> | Record<string, unknown>[];

function applyChartTheme(option: EChartsCoreOption, ct: ChartTheme): EChartsCoreOption {
  const themed: EChartsCoreOption = {
    color: ct.colors,
    backgroundColor: "transparent",
    textStyle: { color: ct.text },
    ...option,
    tooltip: mergeObject({
      backgroundColor: ct.tooltipBg,
      borderColor: ct.tooltipBorder,
      textStyle: { color: ct.tooltipText }
    }, option.tooltip),
    legend: mergeObject({ textStyle: { color: ct.text } }, option.legend),
    xAxis: themeAxis(option.xAxis as AxisOption | undefined, ct, true),
    yAxis: themeAxis(option.yAxis as AxisOption | undefined, ct, true),
  };

  if (option.radar) {
    themed.radar = mergeObject({
      axisName: { color: ct.text },
      splitLine: { lineStyle: { color: ct.grid } },
      splitArea: { areaStyle: { color: ["transparent"] } },
      axisLine: { lineStyle: { color: ct.axis } }
    }, option.radar);
  }

  if (option.visualMap) {
    themed.visualMap = mergeObject({
      textStyle: { color: ct.text }
    }, option.visualMap);
  }

  if (option.calendar) {
    themed.calendar = mergeObject({
      itemStyle: { color: "transparent", borderColor: ct.grid },
      dayLabel: { color: ct.text },
      monthLabel: { color: ct.text },
      yearLabel: { color: ct.text },
      splitLine: { lineStyle: { color: ct.axis } }
    }, option.calendar);
  }

  return themed;
}

function themeAxis(axis: AxisOption | undefined, ct: ChartTheme, splitLine = false) {
  if (!axis) return axis;
  const themeOne = (item: Record<string, unknown>) => mergeObject({
    axisLine: { lineStyle: { color: ct.axis } },
    axisLabel: { color: ct.text },
    nameTextStyle: { color: ct.text },
    splitLine: { lineStyle: { color: splitLine ? ct.grid : "transparent" } }
  }, item);
  return Array.isArray(axis) ? axis.map(themeOne) : themeOne(axis);
}

function mergeObject<T>(base: T, override: unknown): T {
  if (!override || typeof override !== "object" || Array.isArray(override)) return (override ?? base) as T;
  return deepMerge(base as Record<string, unknown>, override as Record<string, unknown>) as T;
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMerge(existing, value)
      : value;
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
