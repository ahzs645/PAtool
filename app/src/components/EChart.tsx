import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import {
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
import styles from "./EChart.module.css";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
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

  const mergedOption = useMemo(() => {
    if (!zoomable) return option;
    return {
      ...option,
      dataZoom: [
        { type: "inside", start: 0, end: 100 },
        { type: "slider", start: 0, end: 100, height: 20, bottom: 4 }
      ]
    };
  }, [option, zoomable]);

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
