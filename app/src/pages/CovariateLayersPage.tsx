import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listCovariateLayerDefinitions,
  planCovariateLayers,
  type CovariateLayerDefinition,
  type CovariateLayerId,
  type CovariateLayerPlan,
  type PasCollection,
} from "@patool/shared";

import { Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import { deriveCollectionBounds, percent } from "./toolsetUtils";
import styles from "./ToolsetPage.module.css";

const layerDefinitions = listCovariateLayerDefinitions();

function definitionFor(id: CovariateLayerId): CovariateLayerDefinition {
  return layerDefinitions.find((definition) => definition.id === id) ?? layerDefinitions[0];
}

export default function CovariateLayersPage() {
  const [selectedIds, setSelectedIds] = useState<CovariateLayerId[]>(
    layerDefinitions.map((definition) => definition.id),
  );
  const [date, setDate] = useState("2024-08-01");

  const { data } = useQuery({
    queryKey: ["covariate-layers-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const bounds = useMemo(() => deriveCollectionBounds(data), [data]);
  const plan = useMemo(() => {
    if (!bounds) return null;
    return planCovariateLayers(bounds, selectedIds, { date, env: {} });
  }, [bounds, date, selectedIds]);

  const toggleLayer = (id: CovariateLayerId) => {
    setSelectedIds((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );
  };

  const columns: Column<CovariateLayerPlan>[] = [
    {
      key: "layer",
      header: "Layer",
      width: 230,
      render: (row) => {
        const definition = definitionFor(row.id);
        return <CellStack primary={row.label} sub={`${definition.provider} - ${definition.cadence}`} />;
      },
    },
    {
      key: "kind",
      header: "Kind",
      width: 120,
      render: (row) => {
        const definition = definitionFor(row.id);
        return <Chip>{definition.kind}</Chip>;
      },
    },
    { key: "readiness", header: "Ready", width: 90, render: (row) => percent(row.readinessScore, 0) },
    {
      key: "keys",
      header: "Keys",
      width: 170,
      render: (row) => row.requiredEnv.length ? row.requiredEnv.join(", ") : "none",
    },
    {
      key: "warnings",
      header: "Warnings",
      width: 180,
      render: (row) => row.warnings.length ? <Chip variant="warning">{row.warnings.length} missing</Chip> : <Chip variant="success">ready</Chip>,
    },
    {
      key: "urls",
      header: "Sources",
      width: 180,
      render: (row) => <CellStack primary={`${row.sourceUrls.length} URL${row.sourceUrls.length === 1 ? "" : "s"}`} sub={row.sourceUrls[0]} />,
    },
  ];

  if (!data || !bounds || !plan) return <Loader message="Planning covariate layers..." />;

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Covariate Builder"
        title="External PM2.5 modeling layers"
        subtitle="Plan Worker/static-data loaders for weather, land cover, roads, population, POIs, smoke, fire, and reference-monitor covariates."
      />

      <div className={styles.stats}>
        <StatCard label="Selected layers" value={String(selectedIds.length)} />
        <StatCard label="Readiness" value={percent(plan.readinessScore, 0)} />
        <StatCard label="North / south" value={`${bounds.north.toFixed(2)} / ${bounds.south.toFixed(2)}`} />
        <StatCard label="West / east" value={`${bounds.west.toFixed(2)} / ${bounds.east.toFixed(2)}`} />
      </div>

      <Card title="Layer selection">
        <div className={styles.controls}>
          <label className={styles.field}>
            <span>Study date</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <div className={styles.checkboxGrid}>
          {layerDefinitions.map((definition) => (
            <label className={styles.checkbox} key={definition.id}>
              <input
                type="checkbox"
                checked={selectedIds.includes(definition.id)}
                onChange={() => toggleLayer(definition.id)}
              />
              <span>
                <strong>{definition.label}</strong>
                {definition.pm25Relevance}
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card title="Layer plan">
        <DataTable columns={columns} data={plan.layers} rowKey={(row) => row.id} emptyMessage="No covariate layers selected." />
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Source URLs">
          <ul className={styles.urlList}>
            {plan.layers.flatMap((layer) => layer.sourceUrls.map((url) => (
              <li key={`${layer.id}-${url}`}>{url}</li>
            )))}
          </ul>
        </Card>
        <Card title="Implementation notes">
          <ul className={styles.noteList}>
            {plan.layers.map((layer) => (
              <li key={layer.id}>
                <strong>{layer.label}</strong>: {layer.cacheSupportNote} {layer.staticSupportNote}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
