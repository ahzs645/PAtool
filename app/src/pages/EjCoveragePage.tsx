import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  computeCoverageGapReport,
  parseEjAreaCsv,
  type EjAreaUnit,
  type EjSensor,
  type PasCollection,
} from "@patool/shared";

import { Button, Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { downloadCsv, objectsToCsv, suggestFilename } from "../lib/exporters";
import styles from "./ToolsetPage.module.css";

const SAMPLE_EJ_CSV = `id,label,latitude,longitude,population,ejIndex,lowIncomeFraction
T001,Downtown,47.605,-122.335,18500,82,0.41
T002,University,47.658,-122.314,21000,55,0.28
T003,South Park,47.532,-122.323,9800,91,0.55
T004,Capitol Hill,47.620,-122.319,28500,49,0.22
T005,White Center,47.518,-122.348,12300,94,0.62
T006,Beacon Hill,47.581,-122.318,15800,76,0.38
T007,Magnolia,47.658,-122.392,18900,28,0.10`;

export default function EjCoveragePage() {
  const [csv, setCsv] = useState<string>(SAMPLE_EJ_CSV);
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [minPopulation, setMinPopulation] = useState<number>(500);

  const { data } = useQuery({
    queryKey: ["ej-coverage-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const ejUnits: EjAreaUnit[] = useMemo(() => parseEjAreaCsv(csv), [csv]);

  const sensors: EjSensor[] = useMemo(() => {
    if (!data) return [];
    return data.records
      .filter((record) =>
        Number.isFinite(record.latitude) &&
        Number.isFinite(record.longitude) &&
        record.locationType !== "inside",
      )
      .map((record) => ({
        id: record.id,
        latitude: record.latitude,
        longitude: record.longitude,
        online: true,
      }));
  }, [data]);

  const report = useMemo(
    () => computeCoverageGapReport(ejUnits, sensors, { radiusKm, minPopulation }),
    [ejUnits, sensors, radiusKm, minPopulation],
  );

  const columns: Column<typeof report.rows[number]>[] = [
    {
      key: "unit",
      header: "Tract",
      width: 220,
      render: (row) => <CellStack primary={row.unit.label ?? row.unit.id} sub={row.unit.id} />,
    },
    {
      key: "pop",
      header: "Population",
      width: 100,
      render: (row) => row.unit.population.toLocaleString(),
    },
    {
      key: "ej",
      header: "EJ index",
      width: 100,
      render: (row) =>
        row.unit.ejIndex === undefined ? (
          <Chip>n/a</Chip>
        ) : (
          <Chip variant={row.unit.ejIndex >= 75 ? "danger" : row.unit.ejIndex >= 50 ? "warning" : "default"}>
            {row.unit.ejIndex.toFixed(0)}
          </Chip>
        ),
    },
    {
      key: "sensors",
      header: `Sensors (≤${radiusKm} km)`,
      width: 120,
      render: (row) => (
        <Chip variant={row.sensorCount === 0 ? "danger" : row.sensorCount < 2 ? "warning" : "success"}>
          {row.sensorCount}
        </Chip>
      ),
    },
    {
      key: "density",
      header: "Sensors / 10k pop",
      width: 130,
      render: (row) => row.sensorsPer10kPop.toFixed(2),
    },
    {
      key: "nearest",
      header: "Nearest km",
      width: 100,
      render: (row) => row.nearestSensorKm === null ? "-" : row.nearestSensorKm.toFixed(2),
    },
    {
      key: "gap",
      header: "Gap score",
      width: 110,
      render: (row) => (
        <Chip variant={row.gapScore >= 0.7 ? "danger" : row.gapScore >= 0.4 ? "warning" : "default"}>
          {row.gapScore.toFixed(3)}
        </Chip>
      ),
    },
  ];

  if (!data) return <Loader message="Loading EJ coverage..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Environmental Justice"
        title="Sensor coverage gap analysis"
        subtitle="Pair PA network density with EJScreen-style indicators (population, EJ index) to identify high-need / low-coverage tracts. Provide your own EJ CSV to swap the seed data."
      />

      <div className={styles.stats}>
        <StatCard label="Tracts" value={String(report.rows.length)} />
        <StatCard label="Population" value={report.totalPopulation.toLocaleString()} />
        <StatCard
          label="Population without sensors"
          value={report.uncoveredPopulation.toLocaleString()}
          tone={report.uncoveredPopulation === 0 ? "good" : "warn"}
        />
        <StatCard label="Active sensors" value={String(sensors.length)} />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Coverage radius (km)</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              max={100}
              value={radiusKm}
              onChange={(event) => setRadiusKm(Number(event.target.value))}
            />
          </label>
          <label className={styles.field}>
            <span>Min population</span>
            <input
              type="number"
              min={0}
              step={100}
              value={minPopulation}
              onChange={(event) => setMinPopulation(Number(event.target.value))}
            />
          </label>
        </div>
        <details>
          <summary>EJ tract CSV (id,label,latitude,longitude,population,ejIndex,lowIncomeFraction)</summary>
          <textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            rows={10}
            spellCheck={false}
            className={styles.csvBox ?? ""}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "12px", marginTop: 8 }}
          />
        </details>
      </Card>

      <Card title="Coverage gap ranking">
        <div className={styles.controls}>
          <Button
            variant="secondary"
            disabled={report.rows.length === 0}
            onClick={() => {
              const rows = report.rows.map((row) => ({
                id: row.unit.id,
                label: row.unit.label ?? "",
                population: row.unit.population,
                ejIndex: row.unit.ejIndex ?? "",
                sensorCount: row.sensorCount,
                sensorsPer10kPop: row.sensorsPer10kPop,
                nearestSensorKm: row.nearestSensorKm ?? "",
                gapScore: row.gapScore,
              }));
              downloadCsv(suggestFilename("ej-coverage-gap", "csv"), objectsToCsv(rows));
            }}
          >
            Download ranking CSV
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={report.rows}
          rowKey={(row) => row.unit.id}
          emptyMessage="No EJ units to rank yet."
        />
      </Card>

      <Card title="Method notes">
        <ul className={styles.noteList}>
          <li>
            Gap score combines normalized inverse sensor density (60%) with normalized EJ need (40%).
            Tracts with no sensors and a high EJ index rise to the top.
          </li>
          <li>
            For a publishable map, replace the seed CSV with EJScreen 2.3 Tract-level CSV
            (Population, Supplemental EJ Index by pollutant). Higher resolutions like block
            groups also work.
          </li>
          <li>
            Coverage radius defaults to 5 km, similar to the Mullen et al. 2025 Maricopa
            analysis. Adjust per region: rural studies often use 10–20 km.
          </li>
        </ul>
      </Card>
    </div>
  );
}
