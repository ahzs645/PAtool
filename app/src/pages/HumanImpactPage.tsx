import { useMemo, useState } from "react";
import type { EChartsCoreOption } from "echarts/core";

import {
  computeHumanImpactMetrics,
  estimatePm25LifeExpectancyImpact,
  PM25_STANDARDS,
  summarizeMonthlyCompliance,
  type AirQualityStandardKey,
  type LifeTableAgeBand,
  type MonthlyExposureUnit,
} from "@patool/shared";

import { Card, PageHeader, StatCard } from "../components";
import { EChart } from "../components/EChart";
import { useChartTheme } from "../hooks/useChartTheme";
import styles from "./HumanImpactPage.module.css";

const regions = [
  { name: "Delhi", baseline: 92, seasonal: 24, trend: -1.2, population: 32_000_000 },
  { name: "Punjab", baseline: 58, seasonal: 18, trend: -0.6, population: 30_000_000 },
  { name: "Uttar Pradesh", baseline: 66, seasonal: 22, trend: 0.3, population: 241_000_000 },
  { name: "Kerala", baseline: 24, seasonal: 8, trend: 0.2, population: 36_000_000 },
  { name: "Karnataka", baseline: 31, seasonal: 10, trend: 0.4, population: 68_000_000 },
  { name: "Lakshadweep", baseline: 15, seasonal: 5, trend: 0.1, population: 70_000 },
];

const years = Array.from({ length: 8 }, (_, index) => 2017 + index);

const lifeBands: LifeTableAgeBand[] = [
  { ageStart: 0, ageEnd: 5, mortalityProbability: 0.018 },
  { ageStart: 5, ageEnd: 20, mortalityProbability: 0.006 },
  { ageStart: 20, ageEnd: 40, mortalityProbability: 0.018 },
  { ageStart: 40, ageEnd: 60, mortalityProbability: 0.085 },
  { ageStart: 60, ageEnd: 75, mortalityProbability: 0.34 },
  { ageStart: 75, ageEnd: 90, mortalityProbability: 0.72 },
];

const sampleUnits = buildSampleUnits();

export default function HumanImpactPage() {
  const chartTheme = useChartTheme();
  const [standardKey, setStandardKey] = useState<AirQualityStandardKey>("india-annual-pm25");
  const [observedPm25, setObservedPm25] = useState(35);
  const [relativeRisk, setRelativeRisk] = useState(1.08);
  const [disabilityWeight, setDisabilityWeight] = useState(0.2);

  const standard = PM25_STANDARDS[standardKey];
  const compliance = useMemo(
    () => summarizeMonthlyCompliance(sampleUnits, standard),
    [standard],
  );
  const stripeRows = useMemo(() => {
    return regions.map((region) => {
      const cells = years.map((year) => {
        const yearCells = compliance.filter((cell) => cell.region === region.name && cell.year === year);
        const winter = yearCells.filter((cell) => cell.month === 1 || cell.month === 2 || cell.month === 12);
        const rate = winter.reduce((total, cell) => total + (cell.populationComplianceRate ?? cell.complianceRate), 0) / winter.length;
        const pm25 = winter.reduce((total, cell) => total + (cell.populationWeightedPm25 ?? cell.meanPm25), 0) / winter.length;
        return { year, rate, pm25 };
      });
      return { region: region.name, cells };
    });
  }, [compliance]);

  const populationCompliance = compliance.reduce((total, cell) => total + (cell.populationComplianceRate ?? 0), 0) / compliance.length;
  const lifeImpact = estimatePm25LifeExpectancyImpact({
    bands: lifeBands,
    observedPm25,
    counterfactualPm25: PM25_STANDARDS["who-annual-pm25"].thresholdUgM3,
    relativeRiskPer10UgM3: relativeRisk,
  });
  const humanMetrics = computeHumanImpactMetrics({
    lifeYearsLost: lifeImpact.yearsLostPerPerson,
    yearsWithCondition: 30,
    disabilityWeight,
    pollutionFev1DeclineMlPerYear: 22.5,
    exposureYears: 10,
  });

  const trendOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    legend: { textStyle: { color: chartTheme.text } },
    grid: { left: 44, right: 20, top: 30, bottom: 38 },
    xAxis: { type: "category", data: years, axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    yAxis: { type: "value", name: "PM2.5", axisLabel: { color: chartTheme.text }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    series: regions.slice(0, 5).map((region) => ({
      name: region.name,
      type: "line",
      smooth: true,
      symbolSize: 5,
      data: years.map((year) => annualPm25(region.baseline, region.trend, year)),
      markLine: {
        symbol: "none",
        label: { color: chartTheme.text },
        lineStyle: { type: "dashed", color: chartTheme.axis },
        data: region.name === "Delhi" ? [
          { yAxis: PM25_STANDARDS["who-annual-pm25"].thresholdUgM3, name: "WHO" },
          { yAxis: PM25_STANDARDS["india-annual-pm25"].thresholdUgM3, name: "India" },
        ] : [],
      },
    })),
  }), [chartTheme]);

  const impactOption = useMemo<EChartsCoreOption>(() => ({
    color: chartTheme.colors,
    tooltip: { trigger: "axis" },
    grid: { left: 44, right: 18, top: 20, bottom: 30 },
    xAxis: { type: "category", data: ["LYL", "YLD", "DALY", "Extra lung age"], axisLabel: { color: chartTheme.text }, axisLine: { lineStyle: { color: chartTheme.axis } } },
    yAxis: { type: "value", name: "years", axisLabel: { color: chartTheme.text }, splitLine: { lineStyle: { color: chartTheme.grid } } },
    series: [{
      type: "bar",
      data: [
        humanMetrics.lifeYearsLost,
        humanMetrics.yearsLivedWithDisability,
        humanMetrics.disabilityAdjustedLifeYears,
        humanMetrics.extraLungAgeYears,
      ].map((value) => Number(value.toFixed(2))),
      barMaxWidth: 52,
    }],
  }), [chartTheme, humanMetrics]);

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Human Impact"
        title="Turn PM2.5 into compliance, life years, and health capacity"
        subtitle="Inspired by biteSizedAQ compliance stripes, life-table walkthroughs, and human-centric air-quality metrics. The demo data is synthetic, so the page can run without the R geospatial stack."
      />

      <div className={styles.stats}>
        <StatCard label="Selected threshold" value={`${standard.thresholdUgM3} ug/m3`} />
        <StatCard label="Population compliance" value={`${(populationCompliance * 100).toFixed(0)}%`} tone={populationCompliance >= 0.8 ? "good" : "warn"} />
        <StatCard label="Life years lost" value={lifeImpact.yearsLostPerPerson.toFixed(2)} tone={lifeImpact.yearsLostPerPerson < 1 ? "good" : "warn"} />
        <StatCard label="DALY equivalent" value={humanMetrics.disabilityAdjustedLifeYears.toFixed(2)} />
      </div>

      <Card title="Scenario controls">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Compliance standard</span>
            <select value={standardKey} onChange={(event) => setStandardKey(event.target.value as AirQualityStandardKey)}>
              {Object.values(PM25_STANDARDS).map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Observed PM2.5</span>
            <input type="number" min={0} max={150} value={observedPm25} onChange={(event) => setObservedPm25(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>RR per 10 ug/m3</span>
            <input type="number" min={1} max={1.5} step={0.01} value={relativeRisk} onChange={(event) => setRelativeRisk(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>Disability weight</span>
            <input type="number" min={0} max={1} step={0.05} value={disabilityWeight} onChange={(event) => setDisabilityWeight(Number(event.target.value))} />
          </label>
        </div>
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Winter compliance stripes">
          <div className={styles.stripeHeader}>
            <span />
            {years.map((year) => <span key={year}>{year}</span>)}
          </div>
          {stripeRows.map((row) => (
            <div className={styles.stripeRow} key={row.region}>
              <span className={styles.rowLabel}>{row.region}</span>
              {row.cells.map((cell) => (
                <span
                  key={`${row.region}-${cell.year}`}
                  className={styles.stripeCell}
                  title={`${row.region} ${cell.year}: ${(cell.rate * 100).toFixed(0)}% compliant, ${cell.pm25.toFixed(1)} ug/m3`}
                  style={{ background: complianceColor(cell.rate) }}
                />
              ))}
            </div>
          ))}
          <div className={styles.legend}>
            <span className={styles.legendLabel}>Compliance</span>
            {[0, 0.25, 0.5, 0.75, 1].map((rate) => (
              <span className={styles.legendLabel} key={rate}>
                <span className={styles.legendSwatch} style={{ background: complianceColor(rate) }} /> {(rate * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </Card>

        <Card title="Human ledger">
          <ul className={styles.metricList}>
            <li><strong>Life years lost</strong>{humanMetrics.lifeYearsLost.toFixed(2)} years from excess mortality.</li>
            <li><strong>Years lived with disability</strong>{humanMetrics.yearsLivedWithDisability.toFixed(2)} healthy-year equivalents.</li>
            <li><strong>Lung aging rate</strong>{humanMetrics.lungAgingRate.toFixed(2)} biological years per calendar year.</li>
            <li><strong>Attributable fraction</strong>{(lifeImpact.attributableFraction * 100).toFixed(1)}% of mortality probability in this simplified scenario.</li>
          </ul>
        </Card>
      </div>

      <div className={styles.splitGrid}>
        <Card title="Small-multiple trend source">
          <EChart option={trendOption} height={360} />
        </Card>
        <Card title="Health-capacity translation">
          <EChart option={impactOption} height={360} />
        </Card>
      </div>
    </div>
  );
}

function buildSampleUnits(): MonthlyExposureUnit[] {
  const rows: MonthlyExposureUnit[] = [];
  for (const region of regions) {
    for (const year of years) {
      for (let month = 1; month <= 12; month += 1) {
        for (let unit = 0; unit < 6; unit += 1) {
          const populationShare = [0.08, 0.12, 0.15, 0.18, 0.2, 0.27][unit];
          rows.push({
            region: region.name,
            year,
            month,
            pm25: monthlyPm25(region.baseline, region.seasonal, region.trend, year, month, unit),
            population: region.population * populationShare,
          });
        }
      }
    }
  }
  return rows;
}

function annualPm25(baseline: number, trend: number, year: number): number {
  return Math.max(3, baseline + trend * (year - 2017));
}

function monthlyPm25(
  baseline: number,
  seasonal: number,
  trend: number,
  year: number,
  month: number,
  unit: number,
): number {
  const winterLift = Math.cos(((month - 1) / 12) * Math.PI * 2) * seasonal;
  const monsoonRelief = month >= 7 && month <= 9 ? seasonal * 0.65 : 0;
  const localSpread = (unit - 2.5) * 2.4;
  return Math.max(2, annualPm25(baseline, trend, year) + winterLift - monsoonRelief + localSpread);
}

function complianceColor(rate: number): string {
  if (rate >= 0.8) return "#2e9e8f";
  if (rate >= 0.6) return "#89b55a";
  if (rate >= 0.4) return "#e5b84c";
  if (rate >= 0.2) return "#e1844f";
  return "#c94a4a";
}
