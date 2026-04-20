import { startTransition, useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import {
  pasFilter,
  pm25ToAqiBand,
  type EnhancedSohIndexResult,
  type OutlierResult,
  type PasCollection,
  type PasRecord,
  type PatSeries,
} from "@patool/shared";
import { PageHeader, StatCard, Card, Button, DataTable } from "../components";
import { getJson, postJson } from "../lib/api";
import { SensorSidePanel } from "./explorer/SensorSidePanel";
import { buildColumns, getPm25ForWindow } from "./explorer/sensorTable";
import { pm25WindowOptions, type Pm25Window, type SidePanelTab } from "./explorer/types";
import { useResizablePanel } from "./explorer/useResizablePanel";
import styles from "./ExplorerPage.module.css";

export default function ExplorerPage() {
  const [query, setQuery] = useState("");
  const [outsideOnly, setOutsideOnly] = useState(true);
  const [pm25Window, setPm25Window] = useState<Pm25Window>("pm25_1hr");
  const [panelOpen, setPanelOpen] = useState(false);
  const [displayedSensor, setDisplayedSensor] = useState<PasRecord | null>(null);
  const [activeTab, setActiveTab] = useState<SidePanelTab>("home");
  const { panelWidth, isResizing, handleMouseDown } = useResizablePanel(400);
  const deferredQuery = useDeferredValue(query);
  const navigate = useNavigate();

  const handleRowClick = (r: PasRecord) => {
    setDisplayedSensor(r);
    setPanelOpen(true);
    setActiveTab("home");
  };

  const handleClosePanel = () => {
    setPanelOpen(false);
    // Don't clear displayedSensor immediately - let animation finish
  };

  const { data } = useQuery({
    queryKey: ["pas"],
    queryFn: () => getJson<PasCollection>("/api/pas")
  });

  const { data: patData, isLoading: patLoading } = useQuery({
    queryKey: ["side-panel-pat", displayedSensor?.id],
    queryFn: () => getJson<PatSeries>(`/api/pat?id=${displayedSensor!.id}&aggregate=raw`),
    enabled: Boolean(displayedSensor) && (activeTab === "timeseries" || activeTab === "health" || activeTab === "diagnostics"),
  });

  const { data: sohData, isLoading: sohLoading } = useQuery({
    queryKey: ["side-panel-soh", displayedSensor?.id],
    queryFn: () => postJson<EnhancedSohIndexResult>("/api/soh/enhanced", { series: patData }),
    enabled: Boolean(patData) && activeTab === "health",
  });

  const { data: outlierData, isLoading: outlierLoading } = useQuery({
    queryKey: ["side-panel-outliers", displayedSensor?.id],
    queryFn: () => postJson<OutlierResult>("/api/outliers", { series: patData, windowSize: 7, thresholdMin: 3 }),
    enabled: Boolean(patData) && activeTab === "diagnostics",
  });

  const filtered = useMemo(() => {
    if (!data) return null;
    return pasFilter(data, {
      labelQuery: deferredQuery,
      isOutside: outsideOnly ? true : undefined
    });
  }, [data, deferredQuery, outsideOnly]);

  const columns = useMemo(() => buildColumns(pm25Window), [pm25Window]);

  if (!filtered) {
    return (
      <div className={styles.grid}>
        <Card>
          <PageHeader
            eyebrow="PAS Explorer"
            title="Browse synoptic PurpleAir coverage"
            subtitle="Loading archive-backed sensor snapshots from the worker API."
          />
        </Card>
      </div>
    );
  }

  const windowLabel = pm25WindowOptions.find((o) => o.value === pm25Window)?.label ?? "1hr";
  const averagePm =
    filtered.records.reduce((sum, r) => sum + getPm25ForWindow(r, pm25Window), 0) /
    Math.max(filtered.records.length, 1);
  const meanBand = pm25ToAqiBand(averagePm);

  return (
    <div className={styles.pageLayout}>
      <div className={styles.mainContent}>
        <div className={styles.hero}>
          <PageHeader
            eyebrow="PAS Explorer"
            title="Browse synoptic PurpleAir coverage"
            subtitle="Filter live or archive-backed sensor snapshots, inspect AQI-adjacent PM2.5, and jump into a detailed timeseries workflow."
          />

          <div className={styles.controls}>
            <input
              aria-label="Sensor search"
              className={styles.search}
              placeholder="Search by label..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="PM2.5 time window"
              className={styles.select}
              value={pm25Window}
              onChange={(e) => setPm25Window(e.target.value as Pm25Window)}
            >
              {pm25WindowOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  PM2.5 {opt.label}
                </option>
              ))}
            </select>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={outsideOnly}
                onChange={() => setOutsideOnly((v) => !v)}
              />
              Outside only
            </label>
            <Button
              onClick={() =>
                startTransition(() => {
                  const target = filtered.records[0]?.id ?? "1001";
                  navigate(`/sensor/${target}`);
                })
              }
            >
              Open first match
            </Button>
          </div>

          <div className={styles.stats}>
            <StatCard label="Visible sensors" value={`${filtered.records.length}`} />
            <StatCard
              label={`Mean PM2.5 (${windowLabel})`}
              value={`${averagePm.toFixed(2)} ug/m3`}
              tone={meanBand.label === "Good" ? "good" : "warn"}
            />
            <StatCard label="AQI band" value={meanBand.label} />
          </div>
        </div>

        <Card padded={false} className={styles.listCard}>
          <div className={styles.viewBar}>
            <div className={styles.viewBarLeft}>
              <span className={styles.viewName}>All Sensors &middot; {filtered.records.length}</span>
            </div>
            <div className={styles.viewBarRight}>
              <button className={styles.viewBarButton}>Filter</button>
              <button className={styles.viewBarButton}>Sort</button>
              <button className={styles.viewBarButton}>Options</button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered.records}
            rowKey={(r) => r.id}
            onRowClick={handleRowClick}
            selectedRowKey={displayedSensor?.id ?? null}
            emptyMessage="No sensors match your filter"
            pageSize={25}
            footer={<span>{filtered.records.length} sensors</span>}
          />
        </Card>
      </div>

      <SensorSidePanel
        panelOpen={panelOpen}
        isResizing={isResizing}
        panelWidth={panelWidth}
        onResizeMouseDown={handleMouseDown}
        displayedSensor={displayedSensor}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        patData={patData}
        patLoading={patLoading}
        sohData={sohData}
        sohLoading={sohLoading}
        outlierData={outlierData}
        outlierLoading={outlierLoading}
        onClose={handleClosePanel}
        onOpenDiagnostics={(sensorId) => navigate(`/diagnostics/${sensorId}`)}
        onOpenSensor={(sensorId) => navigate(`/sensor/${sensorId}`)}
      />
    </div>
  );
}
