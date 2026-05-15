import type { EChartsCoreOption } from "echarts/core";
import type { AdjustedMobilePoint, HistogramBin, MobileCalendarCell, MobileSensingPoint, RouteSegmentSummary } from "@patool/shared";

const CATEGORY_COLORS = {
  good: "#3aa76d",
  moderate: "#d6a100",
  "unhealthy-sensitive": "#d96c2c",
  unhealthy: "#cf3f4b",
  "very-unhealthy": "#7c4bb7",
  hazardous: "#7c2d12",
};

export function campaignTimeSeriesOption(
  points: ReadonlyArray<MobileSensingPoint>,
  adjusted: ReadonlyArray<AdjustedMobilePoint>,
): EChartsCoreOption {
  return {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { left: 48, right: 24, top: 42, bottom: 40 },
    xAxis: { type: "category", data: points.map((point) => point.timestamp.slice(5, 16).replace("T", " ")) },
    yAxis: { type: "value", name: "PM2.5" },
    series: [
      { name: "Mobile PM2.5", type: "line", smooth: true, symbolSize: 6, data: points.map((point) => round(point.pm25)) },
      { name: "Adjusted PM2.5", type: "line", smooth: true, symbolSize: 6, data: adjusted.map((point) => round(point.adjustedPm25)) },
    ],
  };
}

export function histogramOption(bins: ReadonlyArray<HistogramBin>): EChartsCoreOption {
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 48, right: 20, top: 20, bottom: 44 },
    xAxis: { type: "category", name: "PM2.5", data: bins.map((bin) => `${round(bin.min)}-${round(bin.max)}`) },
    yAxis: { type: "value", name: "Count" },
    series: [{ name: "Observations", type: "bar", data: bins.map((bin) => bin.count), itemStyle: { color: "#277da1" } }],
  };
}

export function calendarOption(cells: ReadonlyArray<MobileCalendarCell>): EChartsCoreOption {
  return {
    tooltip: {
      formatter: (params: unknown) => {
        const value = (params as { data?: { value?: unknown[] } }).data?.value;
        if (!Array.isArray(value)) return "";
        return `${value[3]}<br/>PM2.5 ${value[2]}<br/>${value[4]} samples`;
      },
    },
    grid: { left: 40, right: 20, top: 16, bottom: 36 },
    xAxis: { type: "category", data: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
    yAxis: { type: "category", data: [...new Set(cells.map((cell) => `Week ${cell.weekIndex + 1}`))] },
    series: [{
      name: "Daily mean",
      type: "scatter",
      symbolSize: 24,
      data: cells.map((cell) => ({
        value: [cell.dayOfWeek, `Week ${cell.weekIndex + 1}`, round(cell.pm25Mean), cell.date, cell.sampleCount],
        itemStyle: { color: CATEGORY_COLORS[cell.aqiCategory] },
      })),
    }],
  };
}

export function segmentOption(segments: ReadonlyArray<RouteSegmentSummary>): EChartsCoreOption {
  return {
    tooltip: { trigger: "axis" },
    grid: { left: 56, right: 20, top: 20, bottom: 60 },
    xAxis: { type: "category", data: segments.map((segment) => segment.segmentId), axisLabel: { rotate: 35 } },
    yAxis: { type: "value", name: "PM2.5" },
    series: [{ name: "Segment mean", type: "bar", data: segments.map((segment) => round(segment.pm25Mean)), itemStyle: { color: "#4d908e" } }],
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
