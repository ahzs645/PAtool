import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  applyPurpleAirCorrection,
  classifyPm25Regime,
  estimateRegimeSeparatedExposure,
  evaluateChannelAgreement,
  PURPLEAIR_CORRECTION_PROFILES,
  summarizeRegimeClassifications,
  type PasCollection,
  type PasRecord,
  type Pm25Regime,
  type PurpleAirCorrectionProfileId,
  type PurpleAirInputBasis,
  type RegimeConfidence,
  type SmokeDensity,
} from "@patool/shared";

import { Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { formatMetric, percent, SENSOR_VALUE_FIELDS } from "./toolsetUtils";
import styles from "./ToolsetPage.module.css";

type RegimeRow = {
  id: string;
  label: string;
  pm25: number;
  humidity: number | null;
  temperature: number | null;
  regime: Pm25Regime;
  confidence: RegimeConfidence;
  wildfireIncrement: number | null;
  localPm25: number | null;
  uncertainty: number | null;
  reasons: string[];
};

type CorrectionReadinessRow = {
  profileId: PurpleAirCorrectionProfileId;
  label: string;
  basis: PurpleAirInputBasis;
  available: number;
  correctedMean: number | null;
};

function numericRecordValue(record: PasRecord, key: keyof PasRecord): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pm25ForBasis(record: PasRecord, basis: PurpleAirInputBasis): number | null {
  if (basis === "cf_1") return numericRecordValue(record, "pm25Cf1");
  if (basis === "atm") return numericRecordValue(record, "pm25Atm");
  return numericRecordValue(record, "pm25Alt");
}

function regimeChipVariant(regime: Pm25Regime): "default" | "success" | "warning" | "danger" | "accent" {
  if (regime === "wildfire" || regime === "mixed") return "danger";
  if (regime === "winter-inversion" || regime === "local") return "warning";
  if (regime === "background") return "success";
  if (regime === "sensor-fault") return "accent";
  return "default";
}

function confidenceChipVariant(confidence: RegimeConfidence): "default" | "success" | "warning" {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "warning";
  return "default";
}

function buildChannelAgreement(record: PasRecord): boolean | null {
  const a = numericRecordValue(record, "pm25Cf1A") ?? numericRecordValue(record, "pm25AtmA");
  const b = numericRecordValue(record, "pm25Cf1B") ?? numericRecordValue(record, "pm25AtmB");
  const agreement = evaluateChannelAgreement(a, b, "qapp-hourly");
  return agreement.level === "unavailable" ? null : agreement.valid;
}

export default function RegimeWorkbenchPage() {
  const [valueField, setValueField] = useState<keyof PasRecord>("pm25_1hr");
  const [smokeDensity, setSmokeDensity] = useState<SmokeDensity>("none");
  const [nearbyFire, setNearbyFire] = useState(false);
  const [windAlignedWithFire, setWindAlignedWithFire] = useState(false);
  const [lowWind, setLowWind] = useState(false);
  const [localSourceSignal, setLocalSourceSignal] = useState(false);
  const [backgroundPm25, setBackgroundPm25] = useState(5);
  const [sampleSize, setSampleSize] = useState(80);

  const { data } = useQuery({
    queryKey: ["regime-workbench-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const rows = useMemo<RegimeRow[]>(() => {
    if (!data) return [];
    const records = data.records
      .filter((record) => record.locationType !== "inside")
      .filter((record) => numericRecordValue(record, valueField) !== null)
      .slice(0, Math.max(1, sampleSize));

    return records.map((record) => {
      const pm25 = numericRecordValue(record, valueField)!;
      const classification = classifyPm25Regime({
        timestamp: data.generatedAt,
        pm25,
        temperatureF: numericRecordValue(record, "temperature"),
        relativeHumidity: numericRecordValue(record, "humidity"),
        channelAgreementValid: buildChannelAgreement(record),
        smokeDensity,
        nearbyFire,
        windAlignedWithFire,
        lowWindOrInversionSignal: lowWind,
        localSourceSignal,
        referencePm25: backgroundPm25,
      });
      const exposure = estimateRegimeSeparatedExposure({
        totalPm25: pm25,
        backgroundPm25,
        classification,
      });
      return {
        id: record.uniqueId ?? record.id,
        label: record.label,
        pm25,
        humidity: numericRecordValue(record, "humidity"),
        temperature: numericRecordValue(record, "temperature"),
        regime: classification.regime,
        confidence: classification.confidence,
        wildfireIncrement: exposure.wildfireIncrementPm25,
        localPm25: exposure.localPm25,
        uncertainty: exposure.uncertaintyPm25,
        reasons: classification.reasons,
      };
    });
  }, [backgroundPm25, data, localSourceSignal, lowWind, nearbyFire, sampleSize, smokeDensity, valueField, windAlignedWithFire]);

  const summary = useMemo(
    () => summarizeRegimeClassifications(rows.map((row) => ({
      pm25: row.pm25,
      classification: {
        regime: row.regime,
        confidence: row.confidence,
        scores: { wildfire: 0, winter: 0, local: 0, fault: 0 },
        reasons: row.reasons,
      },
    }))),
    [rows],
  );

  const correctionReadiness = useMemo<CorrectionReadinessRow[]>(() => {
    if (!data) return [];
    const records = data.records.filter((record) => record.locationType !== "inside");
    return (Object.keys(PURPLEAIR_CORRECTION_PROFILES) as PurpleAirCorrectionProfileId[]).map((profileId) => {
      const profile = PURPLEAIR_CORRECTION_PROFILES[profileId];
      const corrected: number[] = [];
      for (const record of records) {
        const pm25 = pm25ForBasis(record, profile.inputBasis);
        const humidity = numericRecordValue(record, "humidity");
        if (pm25 === null || humidity === null) continue;
        const result = applyPurpleAirCorrection({
          pm25,
          humidity,
          inputBasis: profile.inputBasis,
          profileId,
        });
        if (result) corrected.push(result.pm25Corrected);
      }
      return {
        profileId,
        label: profile.label,
        basis: profile.inputBasis,
        available: corrected.length,
        correctedMean: corrected.length ? corrected.reduce((sum, value) => sum + value, 0) / corrected.length : null,
      };
    });
  }, [data]);

  const totalWildfire = rows.reduce((sum, row) => sum + (row.wildfireIncrement ?? 0), 0);
  const totalLocal = rows.reduce((sum, row) => sum + (row.localPm25 ?? 0), 0);

  const columns: Column<RegimeRow>[] = [
    {
      key: "sensor",
      header: "Sensor",
      width: 230,
      render: (row) => <CellStack primary={row.label} sub={row.id} />,
    },
    { key: "pm25", header: "PM2.5", width: 90, render: (row) => formatMetric(row.pm25) },
    {
      key: "regime",
      header: "Regime",
      width: 150,
      render: (row) => <Chip variant={regimeChipVariant(row.regime)}>{row.regime}</Chip>,
    },
    {
      key: "confidence",
      header: "Confidence",
      width: 120,
      render: (row) => <Chip variant={confidenceChipVariant(row.confidence)}>{row.confidence}</Chip>,
    },
    { key: "wildfire", header: "Wildfire inc.", width: 110, render: (row) => formatMetric(row.wildfireIncrement) },
    { key: "local", header: "Local PM2.5", width: 110, render: (row) => formatMetric(row.localPm25) },
    { key: "uncertainty", header: "Uncertainty", width: 110, render: (row) => formatMetric(row.uncertainty) },
    {
      key: "reason",
      header: "Primary reason",
      width: 260,
      render: (row) => row.reasons[0] ?? "No reason available.",
    },
  ];

  const readinessColumns: Column<CorrectionReadinessRow>[] = [
    {
      key: "profile",
      header: "Correction profile",
      width: 340,
      render: (row) => <CellStack primary={row.label} sub={row.profileId} />,
    },
    { key: "basis", header: "Basis", width: 90, render: (row) => row.basis },
    { key: "available", header: "Rows ready", width: 100, render: (row) => String(row.available) },
    { key: "mean", header: "Mean corrected", width: 130, render: (row) => formatMetric(row.correctedMean) },
  ];

  if (!data) return <Loader message="Loading regime data..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="WP1/WP2"
        title="Regime separation and correction readiness"
        subtitle="Classify PurpleAir observations into local, winter-inversion, wildfire, mixed, and fault regimes, then check which correction profiles are ready for FEM validation."
      />

      <div className={styles.stats}>
        <StatCard label="Sensors classified" value={String(rows.length)} />
        <StatCard label="Regimes found" value={String(summary.length)} />
        <StatCard label="Wildfire increment" value={formatMetric(rows.length ? totalWildfire / rows.length : null)} />
        <StatCard label="Local PM2.5" value={formatMetric(rows.length ? totalLocal / rows.length : null)} />
      </div>

      <Card title="Scenario controls">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Sensor field</span>
            <select value={String(valueField)} onChange={(event) => setValueField(event.target.value as keyof PasRecord)}>
              {SENSOR_VALUE_FIELDS.map((field) => (
                <option key={String(field.value)} value={String(field.value)}>{field.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Smoke density</span>
            <select value={smokeDensity} onChange={(event) => setSmokeDensity(event.target.value as SmokeDensity)}>
              <option value="none">None</option>
              <option value="light">Light</option>
              <option value="medium">Medium</option>
              <option value="heavy">Heavy</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Background PM2.5</span>
            <input type="number" min={0} step={0.5} value={backgroundPm25} onChange={(event) => setBackgroundPm25(Number(event.target.value))} />
          </label>
          <label className={styles.field}>
            <span>Sample cap</span>
            <input type="number" min={10} max={250} value={sampleSize} onChange={(event) => setSampleSize(Number(event.target.value))} />
          </label>
        </div>
        <div className={styles.checkboxGrid}>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={nearbyFire} onChange={() => setNearbyFire((value) => !value)} />
            <span><strong>Nearby fire</strong><span>Use when FIRMS/agency fire detections are close enough to affect the airshed.</span></span>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={windAlignedWithFire} onChange={() => setWindAlignedWithFire((value) => !value)} />
            <span><strong>Smoke transport</strong><span>Use when wind or plume movement points toward the sensors.</span></span>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={lowWind} onChange={() => setLowWind((value) => !value)} />
            <span><strong>Low wind/inversion</strong><span>Use for winter stagnation or bowl-terrain trapping scenarios.</span></span>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={localSourceSignal} onChange={() => setLocalSourceSignal((value) => !value)} />
            <span><strong>Local source</strong><span>Use when wind sectors, timing, or site context indicate local emissions.</span></span>
          </label>
        </div>
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Regime mix">
          <div className={styles.metricGrid}>
            {summary.map((row) => (
              <div className={styles.metricRow} key={row.regime}>
                <span>{row.regime}</span>
                <strong>{row.count} / {percent(row.fraction, 0)}</strong>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Benchmark requirements">
          <ul className={styles.noteList}>
            <li><Chip>WP1</Chip> Add co-located FEM/reference PM2.5 rows to run RMSE, MAE, bias, and R2 by correction profile and regime.</li>
            <li><Chip variant="accent">WP2</Chip> Add HMS/FIRMS/wind joins to replace the scenario toggles with timestamp-specific smoke/local labels.</li>
          </ul>
        </Card>
      </div>

      <Card title="Classified sensors">
        <DataTable columns={columns} data={rows} rowKey={(row) => row.id} pageSize={12} emptyMessage="No outdoor PM2.5 rows are available." />
      </Card>

      <Card title="Correction readiness">
        <DataTable columns={readinessColumns} data={correctionReadiness} rowKey={(row) => row.profileId} emptyMessage="No correction profiles are available." />
      </Card>
    </div>
  );
}
