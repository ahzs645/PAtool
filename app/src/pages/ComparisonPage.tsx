import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { type PatSeries } from "@patool/shared";

import { Loader, PageHeader, Card } from "../components";
import { EChart } from "../components/EChart";
import { getJson } from "../lib/api";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./ComparisonPage.module.css";

export default function ComparisonPage() {
  const ct = useChartTheme();

  const { data: series } = useQuery({
    queryKey: ["comparison-series"],
    queryFn: () => getJson<PatSeries>("/api/pat?id=1001&aggregate=raw")
  });

  const option = useMemo(() => {
    if (!series) return null;
    return {
      textStyle: { fontFamily: "Inter, sans-serif", color: ct.text },
      tooltip: {
        trigger: "item" as const,
        backgroundColor: ct.tooltipBg,
        borderColor: ct.tooltipBorder,
        textStyle: { color: ct.tooltipText }
      },
      grid: { top: 16, right: 16, bottom: 40, left: 48 },
      xAxis: {
        type: "value" as const,
        name: "PM2.5 A",
        axisLabel: { color: ct.axis },
        axisLine: { lineStyle: { color: ct.grid } },
        splitLine: { lineStyle: { color: ct.grid } }
      },
      yAxis: {
        type: "value" as const,
        name: "PM2.5 B",
        axisLabel: { color: ct.axis },
        splitLine: { lineStyle: { color: ct.grid } }
      },
      series: [
        {
          type: "scatter" as const,
          data: series.points.map((p) => [p.pm25A ?? 0, p.pm25B ?? 0]),
          itemStyle: { color: ct.colors[4] },
          large: true,
          largeThreshold: 500
        }
      ]
    };
  }, [series, ct]);

  if (!option) {
    return <Loader message="Loading comparison..." />;
  }

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Comparison"
        title="Channel agreement view"
        subtitle="A comparison surface for monitor/sensor workflows using scatterplots and QC helpers."
      />
      <Card title="Channel scatter">
        <EChart option={option} height={360} />
      </Card>
    </div>
  );
}
