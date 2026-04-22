import { useMemo, useState } from "react";
import {
  fitBayesianLinearModel,
  compareBayesianModels,
  type BayesianFitResult,
  type BayesianLinearObservation,
  type BayesianModelComparison,
} from "@patool/shared";

import {
  Button,
  Card,
  CellStack,
  Chip,
  DataTable,
  PageHeader,
  StatCard,
  type Column,
} from "../components";
import styles from "./OutcomeModelPage.module.css";

type ParsedRow = {
  rowNumber: number;
  outcome: number;
  pm25: number;
  groupId: string;
  extras: Record<string, number>;
};

type ParseResult = {
  rows: ParsedRow[];
  extraColumns: string[];
  warnings: string[];
  headers: string[];
};

// A 60-row synthetic dataset: two counties (A/B) with different baselines,
// a shared PM2.5 → outcome slope of ~0.12, and a mild income covariate.
const SAMPLE_CSV = `school_id,county,outcome,pm25,income_index
A01,A,82.1,8.2,1.02
A02,A,79.8,9.1,0.98
A03,A,77.4,10.5,0.90
A04,A,76.3,11.2,0.88
A05,A,74.9,12.0,0.85
A06,A,73.2,13.1,0.82
A07,A,71.8,14.3,0.80
A08,A,75.6,11.0,0.92
A09,A,78.0,9.8,0.95
A10,A,80.2,8.5,1.00
A11,A,72.1,13.5,0.84
A12,A,77.0,10.1,0.93
A13,A,78.9,9.5,0.97
A14,A,74.3,11.9,0.87
A15,A,81.3,8.0,1.04
B01,B,68.4,9.2,0.78
B02,B,66.1,10.4,0.74
B03,B,63.5,11.8,0.70
B04,B,61.9,12.6,0.66
B05,B,59.2,13.9,0.60
B06,B,65.0,10.9,0.72
B07,B,67.2,9.9,0.75
B08,B,62.8,12.1,0.68
B09,B,69.5,8.8,0.80
B10,B,64.3,11.3,0.71
B11,B,60.4,13.2,0.62
B12,B,66.8,10.2,0.76
B13,B,63.0,11.7,0.67
B14,B,58.6,14.4,0.58
B15,B,70.1,8.3,0.82`;

function parseCsv(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    return { rows: [], extraColumns: [], warnings: ["Need at least a header row + 1 data row."], headers: [] };
  }
  const header = lines[0].split(",").map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const idx = (key: string) => lower.indexOf(key.toLowerCase());

  const outcomeIdx = idx("outcome");
  const pm25Idx = idx("pm25");
  const groupIdx =
    idx("county") >= 0
      ? idx("county")
      : idx("group") >= 0
        ? idx("group")
        : idx("fips") >= 0
          ? idx("fips")
          : -1;
  const idIdxCandidate = idx("id");
  const idIdx = idIdxCandidate >= 0 ? idIdxCandidate : idx("school_id");

  if (outcomeIdx < 0 || pm25Idx < 0) {
    return {
      rows: [],
      extraColumns: [],
      warnings: ["CSV must include 'outcome' and 'pm25' columns."],
      headers: header,
    };
  }

  const skipCols = new Set<number>([outcomeIdx, pm25Idx]);
  if (groupIdx >= 0) skipCols.add(groupIdx);
  if (idIdx >= 0) skipCols.add(idIdx);

  const extraColumns: string[] = [];
  const extraIdx: number[] = [];
  for (let j = 0; j < header.length; j++) {
    if (skipCols.has(j)) continue;
    extraColumns.push(header[j]);
    extraIdx.push(j);
  }

  const rows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",").map((c) => c.trim());
    const outcome = Number(cells[outcomeIdx]);
    const pm25 = Number(cells[pm25Idx]);
    if (!Number.isFinite(outcome) || !Number.isFinite(pm25)) {
      warnings.push(`Row ${i + 1}: skipping (non-numeric outcome or pm25).`);
      continue;
    }
    const extras: Record<string, number> = {};
    let extrasValid = true;
    for (let k = 0; k < extraColumns.length; k++) {
      const raw = cells[extraIdx[k]];
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        extrasValid = false;
        break;
      }
      extras[extraColumns[k]] = num;
    }
    if (!extrasValid) {
      warnings.push(`Row ${i + 1}: skipping (non-numeric covariate value).`);
      continue;
    }
    rows.push({
      rowNumber: i + 1,
      outcome,
      pm25,
      groupId: groupIdx >= 0 ? cells[groupIdx] ?? "" : "",
      extras,
    });
  }

  return { rows, extraColumns, warnings, headers: header };
}

type ModelSpec = {
  id: string;
  label: string;
  includePm25: boolean;
  extraCovariates: string[];
  groupFixedEffects: boolean;
};

function buildObservations(
  rows: ParsedRow[],
  spec: ModelSpec,
): { obs: BayesianLinearObservation[]; covariateNames: string[] } {
  const names: string[] = [];
  if (spec.includePm25) names.push("pm25");
  for (const c of spec.extraCovariates) names.push(c);

  const obs: BayesianLinearObservation[] = rows.map((r) => {
    const x: number[] = [];
    if (spec.includePm25) x.push(r.pm25);
    for (const c of spec.extraCovariates) x.push(r.extras[c] ?? 0);
    return {
      id: `row-${r.rowNumber}`,
      groupId: r.groupId || undefined,
      y: r.outcome,
      x,
    };
  });
  return { obs, covariateNames: names };
}

function exportComparisonCsv(
  comparison: BayesianModelComparison[],
  fits: BayesianFitResult[],
): string {
  const lines: string[] = [];
  lines.push("model,n,k,waic,p_waic,lppd,waic_se,delta_waic,weight");
  for (const c of comparison) {
    lines.push([
      c.label,
      c.n,
      c.k,
      c.waic.toFixed(3),
      c.pWaic.toFixed(3),
      c.lppd.toFixed(3),
      c.waicSe.toFixed(3),
      c.deltaWaic.toFixed(3),
      c.weight.toFixed(4),
    ].join(","));
  }
  lines.push("");
  lines.push("model,coefficient,mean,sd,p025,p975");
  for (const fit of fits) {
    for (const coef of fit.coefficients) {
      lines.push([
        fit.label ?? "model",
        coef.name,
        coef.mean.toFixed(4),
        coef.sd.toFixed(4),
        coef.p025.toFixed(4),
        coef.p975.toFixed(4),
      ].join(","));
    }
  }
  return lines.join("\n");
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function OutcomeModelPage() {
  const [csv, setCsv] = useState<string>(SAMPLE_CSV);
  const [priorScale, setPriorScale] = useState<number>(10);
  const [samples, setSamples] = useState<number>(1000);
  const [seed, setSeed] = useState<number>(42);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [enableGroups, setEnableGroups] = useState<boolean>(true);

  const parsed = useMemo(() => parseCsv(csv), [csv]);
  const hasGroups = parsed.rows.some((r) => r.groupId.length > 0);

  const modelSpecs = useMemo<ModelSpec[]>(() => {
    const specs: ModelSpec[] = [];
    specs.push({
      id: "intercept-only",
      label: "Intercept only",
      includePm25: false,
      extraCovariates: [],
      groupFixedEffects: false,
    });
    specs.push({
      id: "pm25",
      label: "PM2.5",
      includePm25: true,
      extraCovariates: [],
      groupFixedEffects: false,
    });
    if (selectedExtras.length > 0) {
      specs.push({
        id: "pm25-plus-covs",
        label: `PM2.5 + ${selectedExtras.join(", ")}`,
        includePm25: true,
        extraCovariates: selectedExtras,
        groupFixedEffects: false,
      });
    }
    if (enableGroups && hasGroups) {
      specs.push({
        id: "pm25-county-fe",
        label: "PM2.5 + county FE",
        includePm25: true,
        extraCovariates: [],
        groupFixedEffects: true,
      });
      if (selectedExtras.length > 0) {
        specs.push({
          id: "full",
          label: `Full: PM2.5 + ${selectedExtras.join(", ")} + county FE`,
          includePm25: true,
          extraCovariates: selectedExtras,
          groupFixedEffects: true,
        });
      }
    }
    return specs;
  }, [selectedExtras, enableGroups, hasGroups]);

  const fits = useMemo<BayesianFitResult[]>(() => {
    if (parsed.rows.length < 5) return [];
    const out: BayesianFitResult[] = [];
    for (const spec of modelSpecs) {
      const { obs, covariateNames } = buildObservations(parsed.rows, spec);
      try {
        const fit = fitBayesianLinearModel(obs, {
          label: spec.label,
          seed,
          priorScale,
          posteriorSamples: samples,
          covariateNames,
          groupColumns: spec.groupFixedEffects ? "fixed-effects" : "none",
        });
        out.push(fit);
      } catch (err) {
        // Skip models that can't be fit (singular design, etc.).
        // eslint-disable-next-line no-console
        console.warn(`Skipping model ${spec.label}:`, err);
      }
    }
    return out;
  }, [parsed.rows, modelSpecs, seed, priorScale, samples]);

  const comparison = useMemo(() => compareBayesianModels(fits), [fits]);

  const bestFit = useMemo(() => {
    if (comparison.length === 0 || fits.length === 0) return null;
    const bestLabel = comparison[0].label;
    return fits.find((f) => (f.label ?? "") === bestLabel) ?? null;
  }, [comparison, fits]);

  const comparisonColumns: Column<BayesianModelComparison>[] = [
    {
      key: "label",
      header: "Model",
      width: 260,
      render: (row) => (
        <CellStack
          primary={row.label}
          sub={`n=${row.n}, k=${row.k}`}
        />
      ),
    },
    {
      key: "waic",
      header: "WAIC",
      width: 120,
      render: (row) => row.waic.toFixed(2),
    },
    {
      key: "delta",
      header: "Δ WAIC",
      width: 100,
      render: (row) => (
        row.deltaWaic === 0
          ? <Chip variant="success">best</Chip>
          : row.deltaWaic.toFixed(2)
      ),
    },
    {
      key: "weight",
      header: "Weight",
      width: 100,
      render: (row) => `${(row.weight * 100).toFixed(1)}%`,
    },
    {
      key: "pwaic",
      header: "p_WAIC",
      width: 100,
      render: (row) => row.pWaic.toFixed(2),
    },
    {
      key: "se",
      header: "WAIC SE",
      width: 100,
      render: (row) => row.waicSe.toFixed(2),
    },
  ];

  const coefficientColumns: Column<BayesianFitResult["coefficients"][number]>[] = [
    { key: "name", header: "Coefficient", width: 220, render: (row) => row.name },
    {
      key: "mean",
      header: "Posterior mean",
      width: 140,
      render: (row) => row.mean.toFixed(4),
    },
    {
      key: "sd",
      header: "SD",
      width: 100,
      render: (row) => row.sd.toFixed(4),
    },
    {
      key: "ci",
      header: "95% credible interval",
      width: 220,
      render: (row) => `[${row.p025.toFixed(3)}, ${row.p975.toFixed(3)}]`,
    },
    {
      key: "sign",
      header: "Sign",
      width: 110,
      render: (row) => {
        if (row.p025 > 0) return <Chip variant="success">positive</Chip>;
        if (row.p975 < 0) return <Chip variant="accent">negative</Chip>;
        return <Chip>includes 0</Chip>;
      },
    },
  ];

  const toggleExtra = (name: string) => {
    setSelectedExtras((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Outcome linkage"
        title="Bayesian spatiotemporal outcome model"
        subtitle="Link PM2.5 exposure to outcomes with WAIC-compared Bayesian linear models (conjugate Normal-Inverse-Gamma)"
      />

      <div className={styles.stats}>
        <StatCard label="Observations parsed" value={String(parsed.rows.length)} />
        <StatCard label="Extra covariates" value={String(parsed.extraColumns.length)} />
        <StatCard label="Counties / groups" value={hasGroups ? String(new Set(parsed.rows.map((r) => r.groupId).filter(Boolean)).size) : "—"} />
        <StatCard
          label="Best model"
          value={bestFit?.label ?? "—"}
        />
      </div>

      <Card title="Configuration">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Prior scale (σ_β)</span>
            <input
              type="number"
              step={1}
              min={0.1}
              value={priorScale}
              onChange={(e) => setPriorScale(Math.max(0.1, Number(e.target.value) || 10))}
            />
          </label>
          <label className={styles.field}>
            <span>Posterior samples</span>
            <input
              type="number"
              step={100}
              min={50}
              max={5000}
              value={samples}
              onChange={(e) => setSamples(Math.max(50, Math.floor(Number(e.target.value) || 1000)))}
            />
          </label>
          <label className={styles.field}>
            <span>RNG seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))}
            />
          </label>
          <label className={styles.field}>
            <span>County fixed effects</span>
            <select
              value={enableGroups ? "on" : "off"}
              onChange={(e) => setEnableGroups(e.target.value === "on")}
              disabled={!hasGroups}
            >
              <option value="on">Include FE models</option>
              <option value="off">Pooled only</option>
            </select>
          </label>
        </div>
        {parsed.extraColumns.length > 0 && (
          <div className={styles.extraRow}>
            <span className={styles.extraLabel}>Extra covariates:</span>
            <div className={styles.chipRow}>
              {parsed.extraColumns.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`${styles.chipToggle} ${selectedExtras.includes(name) ? styles.chipActive : ""}`}
                  onClick={() => toggleExtra(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Data">
        <p className={styles.cardHint}>
          Paste CSV with <code>outcome</code> and <code>pm25</code> columns (required),
          plus optional <code>county</code> (or <code>group</code>/<code>fips</code>) and
          any number of numeric covariates.
        </p>
        <textarea
          className={styles.csvInput}
          rows={8}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          spellCheck={false}
        />
        {parsed.warnings.length > 0 && (
          <div className={styles.warnings}>
            {parsed.warnings.slice(0, 6).map((w, i) => (
              <div key={i} className={styles.warningRow}>{w}</div>
            ))}
            {parsed.warnings.length > 6 && (
              <div className={styles.warningRow}>…and {parsed.warnings.length - 6} more</div>
            )}
          </div>
        )}
        <div className={styles.csvActions}>
          <Button variant="secondary" onClick={() => setCsv(SAMPLE_CSV)}>
            Reset to sample
          </Button>
          <Button
            disabled={fits.length === 0}
            onClick={() =>
              downloadText(
                `patool-outcome-model-waic.csv`,
                exportComparisonCsv(comparison, fits),
              )
            }
          >
            Download WAIC + coefficients CSV
          </Button>
        </div>
      </Card>

      <Card title={`Model comparison (${comparison.length})`}>
        <p className={styles.cardHint}>
          Lower WAIC = better predictive fit (leave-one-out approximation).
          Weights are Akaike-style over the model set.
        </p>
        <DataTable
          columns={comparisonColumns}
          data={comparison}
          rowKey={(r) => r.label}
          emptyMessage="Need at least 5 rows of data to fit models."
          pageSize={10}
        />
      </Card>

      {bestFit && (
        <Card title={`Posterior coefficients — ${bestFit.label ?? "best model"}`}>
          <p className={styles.cardHint}>
            Posterior summaries from {bestFit.posteriorSamples} samples.
            σ̂ = {bestFit.sigmaMean.toFixed(3)}, RMSE = {bestFit.rmse.toFixed(3)}
            {bestFit.rSquared !== null ? `, R² = ${bestFit.rSquared.toFixed(3)}` : ""}.
          </p>
          <DataTable
            columns={coefficientColumns}
            data={bestFit.coefficients}
            rowKey={(r) => r.name}
            emptyMessage="No coefficients."
            pageSize={25}
          />
        </Card>
      )}
    </div>
  );
}
