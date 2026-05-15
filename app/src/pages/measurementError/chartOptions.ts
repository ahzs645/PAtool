import type { EChartsCoreOption } from "echarts/core";
import { densityPoints, type BlandAltmanSummary, type LinearFit, type MeasurementPair, type RelativeExpandedUncertaintyResult } from "@patool/shared";

type ChartTheme = {
  colors: string[];
  axis: string;
  grid: string;
  text: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
};

export type MeasurementChartContext = {
  theme: ChartTheme;
  units: string;
  pollutant: string;
  maxValue: number;
};

export function formatEquation(fit: Pick<LinearFit, "slope" | "intercept">): string {
  const sign = fit.intercept >= 0 ? "+" : "-";
  return `y = ${fit.slope.toFixed(2)}x ${sign} ${Math.abs(fit.intercept).toFixed(2)}`;
}

function lineEndpoints(maxValue: number, fit: Pick<LinearFit, "slope" | "intercept">) {
  return [
    [0, fit.intercept],
    [maxValue, fit.intercept + fit.slope * maxValue],
  ];
}

function baseText(theme: ChartTheme) {
  return {
    textStyle: { fontFamily: "Inter, sans-serif", color: theme.text },
    tooltip: {
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
  };
}

export function buildScatterOption(
  pairs: MeasurementPair[],
  correctedPairs: MeasurementPair[],
  fit: LinearFit,
  context: MeasurementChartContext,
): EChartsCoreOption {
  const { theme, units, maxValue } = context;
  const density = densityPoints(pairs.map((pair) => ({ x: pair.reference, y: pair.sensor })));
  const correctedDensity = densityPoints(correctedPairs.map((pair) => ({ x: pair.reference, y: pair.sensor })));

  return {
    ...baseText(theme),
    tooltip: { ...baseText(theme).tooltip, trigger: "item" },
    legend: { top: 0, textStyle: { color: theme.text } },
    grid: { top: 42, right: 22, bottom: 42, left: 56 },
    xAxis: {
      type: "value",
      name: `Reference (${units})`,
      min: 0,
      max: maxValue,
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    yAxis: {
      type: "value",
      name: `Candidate (${units})`,
      min: 0,
      max: maxValue,
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    visualMap: {
      show: false,
      min: 1,
      max: Math.max(1, ...density.map((point) => point.value)),
      inRange: { color: [theme.colors[1], theme.colors[0], theme.colors[2]] },
    },
    series: [
      {
        name: "Observed",
        type: "scatter",
        symbolSize: 5,
        data: density.map((point) => [point.x, point.y, point.value]),
      },
      ...(correctedDensity.length ? [{
        name: "Corrected",
        type: "scatter",
        symbolSize: 4,
        itemStyle: { color: theme.colors[1], opacity: 0.55 },
        data: correctedDensity.map((point) => [point.x, point.y]),
      }] : []),
      {
        name: "1:1",
        type: "line",
        symbol: "none",
        lineStyle: { color: theme.text, width: 1.5 },
        data: [[0, 0], [maxValue, maxValue]],
      },
      {
        name: "OLS",
        type: "line",
        symbol: "none",
        lineStyle: { color: theme.colors[2], width: 2, type: "dashed" },
        data: lineEndpoints(maxValue, fit),
      },
    ],
  };
}

export function buildBlandAltmanOption(
  agreement: BlandAltmanSummary,
  context: MeasurementChartContext,
): EChartsCoreOption {
  const { theme, units, maxValue } = context;
  return {
    ...baseText(theme),
    tooltip: { ...baseText(theme).tooltip, trigger: "item" },
    grid: { top: 18, right: 18, bottom: 42, left: 58 },
    xAxis: {
      type: "value",
      name: `Average (${units})`,
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    yAxis: {
      type: "value",
      name: "Sensor - reference",
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        name: "Agreement",
        type: "scatter",
        symbolSize: 5,
        itemStyle: { color: theme.colors[0], opacity: 0.7 },
        data: agreement.points.map((point) => [point.average, point.difference]),
      },
      ...[
        ["Mean", agreement.meanDifference, theme.colors[1]],
        ["Upper", agreement.upperLimit, theme.colors[2]],
        ["Lower", agreement.lowerLimit, theme.colors[2]],
      ].map(([name, value, color]) => ({
        name,
        type: "line",
        symbol: "none",
        lineStyle: { color, width: 1.5, type: name === "Mean" ? "solid" : "dashed" },
        data: [[0, value], [maxValue, value]],
      })),
    ],
  };
}

export function buildReuOption(
  reu: RelativeExpandedUncertaintyResult,
  context: MeasurementChartContext & { dqObjective?: number; limitValue?: number },
): EChartsCoreOption {
  const { theme, units, maxValue, dqObjective, limitValue } = context;
  return {
    ...baseText(theme),
    tooltip: { ...baseText(theme).tooltip, trigger: "item" },
    grid: { top: 18, right: 18, bottom: 42, left: 58 },
    xAxis: {
      type: "value",
      name: `Reference (${units})`,
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    yAxis: {
      type: "value",
      name: "REU (%)",
      min: 0,
      max: 200,
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        name: "REU",
        type: "scatter",
        symbolSize: 5,
        itemStyle: { color: theme.colors[3], opacity: 0.7 },
        data: reu.points.map((point) => [point.reference, point.reu]),
      },
      ...(dqObjective ? [{
        name: "DQO",
        type: "line",
        symbol: "none",
        lineStyle: { color: theme.colors[1], width: 2, type: "dashed" },
        data: [[0, dqObjective], [maxValue, dqObjective]],
      }] : []),
      ...(limitValue ? [{
        name: "Limit value",
        type: "line",
        symbol: "none",
        lineStyle: { color: theme.colors[2], width: 2, type: "dashed" },
        data: [[limitValue, 0], [limitValue, 200]],
      }] : []),
    ],
  };
}

export function buildTimeSeriesOption(
  pairs: MeasurementPair[],
  context: MeasurementChartContext,
): EChartsCoreOption {
  const { theme, units, pollutant } = context;
  return {
    ...baseText(theme),
    tooltip: { ...baseText(theme).tooltip, trigger: "axis" },
    legend: { top: 0, textStyle: { color: theme.text } },
    grid: { top: 42, right: 18, bottom: 42, left: 56 },
    xAxis: {
      type: "category",
      data: pairs.map((pair) => String(pair.time ?? pair.reference)),
      axisLabel: { color: theme.axis },
      axisLine: { lineStyle: { color: theme.grid } },
    },
    yAxis: {
      type: "value",
      name: `${pollutant} (${units})`,
      axisLabel: { color: theme.axis },
      splitLine: { lineStyle: { color: theme.grid } },
    },
    series: [
      {
        name: "Reference",
        type: "line",
        symbol: "none",
        lineStyle: { color: theme.text, width: 1.5 },
        data: pairs.map((pair) => pair.reference),
      },
      {
        name: "Candidate",
        type: "line",
        symbol: "none",
        lineStyle: { color: theme.colors[2], width: 1.2, opacity: 0.75 },
        data: pairs.map((pair) => pair.sensor),
      },
    ],
  };
}
