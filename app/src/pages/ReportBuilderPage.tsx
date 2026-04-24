import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  buildPurpleAirReportSummary,
  buildPurpleAirReportDocument,
  createPurpleAirReportBlueprint,
  createPurpleAirReportPlan,
  renderReportDocumentDocx,
  renderReportDocumentHtml,
  type PasCollection,
  type PasRecord,
  type PatSeries,
  type ReportDocument,
  type ReportFigureReadiness,
  type ReportManagementZone,
  type ReportMonitoringCandidate,
  type ReportNetworkSummary,
  type ReportRecommendation,
  type ReportSensorPercentDifference,
  type ReportTemplateInput,
  type ReportTemplateStep,
} from "@patool/shared";

import { Button, Card, CellStack, Chip, DataTable, Loader, PageHeader, StatCard, type Column } from "../components";
import { getJson } from "../lib/api";
import styles from "./ReportBuilderPage.module.css";

const DEFAULT_COMMUNITY = "Selected community";
const DEFAULT_SENSOR_COUNT = 8;

function formatPm25(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ug/m3` : "-";
}

function formatPercent(value: number | null): string {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function sensorPm25(record: PasRecord): number | null {
  return record.pm25_1hr ?? record.pm25Current ?? record.pm25_1day ?? null;
}

function defaultSensorIds(collection: PasCollection): string[] {
  return collection.records
    .filter((record) => record.locationType !== "inside")
    .slice(0, DEFAULT_SENSOR_COUNT)
    .map((record) => record.id);
}

function exportReportPackage(
  plan: ReturnType<typeof createPurpleAirReportPlan>,
  summary: ReportNetworkSummary,
  blueprint: ReturnType<typeof createPurpleAirReportBlueprint>,
) {
  const payload = JSON.stringify({ plan, summary, blueprint }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  downloadBlob(blob, `${reportFileBase(plan.communityName)}-report-package.json`);
}

function reportFileBase(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "purpleair-report";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function exportDocx(document: ReportDocument) {
  const bytes = renderReportDocumentDocx(document);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    `${reportFileBase(document.communityName)}.docx`,
  );
}

function openPdfPrintView(document: ReportDocument): "print" | "html-fallback" {
  const html = renderReportDocumentHtml(document);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    downloadBlob(new Blob([html], { type: "text/html" }), `${reportFileBase(document.communityName)}-print.html`);
    return "html-fallback";
  }
  let printStarted = false;
  const printWhenReady = () => {
    if (printStarted) return;
    printStarted = true;
    printWindow.requestAnimationFrame(() => {
      printWindow.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 0);
    });
  };
  printWindow.addEventListener("load", printWhenReady, { once: true });
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  if (printWindow.document.readyState === "complete") {
    printWhenReady();
  }
  return "print";
}

export default function ReportBuilderPage() {
  const [communityName, setCommunityName] = useState(DEFAULT_COMMUNITY);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [managementZone, setManagementZone] = useState<ReportManagementZone>("unknown");
  const [emissionInventoryEnabled, setEmissionInventoryEnabled] = useState(false);
  const [emissionInventoryLabel, setEmissionInventoryLabel] = useState("");
  const [localBylawEnabled, setLocalBylawEnabled] = useState(false);
  const [localBylawName, setLocalBylawName] = useState("");
  const [includeDiyCleanAir, setIncludeDiyCleanAir] = useState(false);
  const [cleanAirPartner, setCleanAirPartner] = useState("");
  const [sourceAttributionEnabled, setSourceAttributionEnabled] = useState(false);
  const [attributionSensorId, setAttributionSensorId] = useState("");
  const [windSourceLabel, setWindSourceLabel] = useState("");
  const [residentialDirection, setResidentialDirection] = useState("");
  const [industrialDirection, setIndustrialDirection] = useState("");
  const [wildfireComparison, setWildfireComparison] = useState(false);
  const [wildfireRegion, setWildfireRegion] = useState("");
  const [interventionMonitoring, setInterventionMonitoring] = useState(true);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const { data: collection } = useQuery({
    queryKey: ["report-builder-pas"],
    queryFn: () => getJson<PasCollection>("/api/pas"),
  });

  const outdoorSensors = useMemo(
    () => collection?.records.filter((record) => record.locationType !== "inside") ?? [],
    [collection],
  );

  useEffect(() => {
    if (collection && selectedIds === null) {
      setSelectedIds(defaultSensorIds(collection));
    }
  }, [collection, selectedIds]);

  const activeSelectedIds = selectedIds ?? (collection ? defaultSensorIds(collection) : []);
  const activeAttributionSensorId = attributionSensorId || activeSelectedIds[0] || "";
  const activeAttributionSensor = outdoorSensors.find((sensor) => sensor.id === activeAttributionSensorId);

  const plan = useMemo(() => {
    if (!collection) return null;
    const sectors = [
      residentialDirection
        ? { direction: residentialDirection, sourceType: "residential-wood-smoke" as const, label: "residential area" }
        : null,
      industrialDirection
        ? { direction: industrialDirection, sourceType: "industrial" as const, label: "industrial area" }
        : null,
    ].filter((sector): sector is NonNullable<typeof sector> => Boolean(sector));

    return createPurpleAirReportPlan(collection, {
      communityName,
      title,
      period: {
        start: startDate || undefined,
        end: endDate || undefined,
      },
      selectedSensorIds: activeSelectedIds,
      options: {
        managementZone,
        emissionInventory: {
          enabled: emissionInventoryEnabled,
          label: emissionInventoryLabel || undefined,
        },
        localBylaw: {
          enabled: localBylawEnabled,
          name: localBylawName || undefined,
        },
        cleanAirSpaces: {
          enabled: true,
          includeDiyAirCleaner: includeDiyCleanAir,
          partnerOrganization: cleanAirPartner || undefined,
        },
        sourceAttribution: {
          enabled: sourceAttributionEnabled,
          hotspotSensorId: activeAttributionSensorId || undefined,
          hotspotSensorLabel: activeAttributionSensor?.label,
          windSourceLabel: windSourceLabel || undefined,
          valleyOrientation: "unknown",
          sectors,
        },
        wildfireExclusion: {
          enabled: wildfireComparison,
          region: wildfireRegion || undefined,
          sourceLabel: wildfireRegion ? `${wildfireRegion} wildfire/smoky-skies exclusion dates` : undefined,
        },
        diurnalWildfireComparison: wildfireComparison,
        interventionMonitoring,
      },
    });
  }, [
    activeAttributionSensor?.label,
    activeAttributionSensorId,
    activeSelectedIds,
    cleanAirPartner,
    collection,
    communityName,
    emissionInventoryEnabled,
    emissionInventoryLabel,
    endDate,
    includeDiyCleanAir,
    industrialDirection,
    interventionMonitoring,
    localBylawEnabled,
    localBylawName,
    managementZone,
    residentialDirection,
    sourceAttributionEnabled,
    startDate,
    title,
    wildfireComparison,
    wildfireRegion,
    windSourceLabel,
  ]);

  useEffect(() => {
    setExportStatus(null);
  }, [plan]);

  const seriesQueries = useQueries({
    queries: (plan?.seriesRequests ?? []).map((request) => ({
      queryKey: ["report-builder-series", request.sensorId, request.path],
      queryFn: () => getJson<PatSeries>(request.path),
      enabled: Boolean(plan),
      staleTime: 60_000,
    })),
  });

  const loadedSeries = seriesQueries
    .map((query) => query.data)
    .filter((series): series is PatSeries => Boolean(series));
  const loadingSeries = seriesQueries.some((query) => query.isLoading || query.isFetching);
  const seriesError = seriesQueries.some((query) => query.isError);
  const seriesComplete = Boolean(
    plan &&
    plan.seriesRequests.length > 0 &&
    loadedSeries.length === plan.seriesRequests.length &&
    !loadingSeries &&
    !seriesError,
  );
  const summary = plan && seriesComplete
    ? buildPurpleAirReportSummary(plan, loadedSeries)
    : null;
  const blueprint = plan ? createPurpleAirReportBlueprint(plan, summary) : null;
  const reportDocument = plan && summary && blueprint
    ? buildPurpleAirReportDocument(plan, summary, blueprint)
    : null;
  const exportReady = Boolean(reportDocument && summary && blueprint && seriesComplete);
  const exportMessage = seriesError
    ? "Resolve selected sensor series load errors before export."
    : !seriesComplete
      ? "Load all selected sensor series before export."
      : exportStatus;
  const readyFigureCount = summary?.figureReadiness.filter((figure) => figure.ready).length ?? 0;

  const toggleSensor = (sensorId: string) => {
    setSelectedIds((previous) => {
      const next = previous ?? activeSelectedIds;
      return next.includes(sensorId)
        ? next.filter((id) => id !== sensorId)
        : [...next, sensorId];
    });
  };

  const sensorColumns: Column<PasRecord>[] = [
    {
      key: "selected",
      header: "",
      width: 52,
      render: (record) => (
        <input
          aria-label={`Select ${record.label}`}
          className={styles.sensorCheck}
          type="checkbox"
          checked={activeSelectedIds.includes(record.id)}
          onChange={() => toggleSensor(record.id)}
        />
      ),
    },
    {
      key: "sensor",
      header: "Sensor",
      width: 260,
      render: (record) => (
        <CellStack
          primary={record.label}
          sub={`${record.id} / ${record.latitude.toFixed(3)}, ${record.longitude.toFixed(3)}`}
        />
      ),
    },
    {
      key: "pm25",
      header: "PM2.5",
      width: 110,
      render: (record) => formatPm25(sensorPm25(record)),
    },
    {
      key: "location",
      header: "Location",
      width: 120,
      render: (record) => <Chip>{record.locationType}</Chip>,
    },
  ];

  const figureColumns: Column<ReportFigureReadiness>[] = [
    {
      key: "figure",
      header: "Figure",
      width: 280,
      render: (row) => <CellStack primary={row.label} sub={row.reason} />,
    },
    {
      key: "ready",
      header: "Status",
      width: 100,
      render: (row) => <Chip variant={row.ready ? "success" : "warning"}>{row.ready ? "ready" : "needs data"}</Chip>,
    },
  ];

  const rankingColumns: Column<ReportSensorPercentDifference>[] = [
    {
      key: "sensor",
      header: "Sensor",
      width: 250,
      render: (row) => <CellStack primary={row.label} sub={row.sensorId} />,
    },
    {
      key: "mean",
      header: "Mean PM2.5",
      width: 120,
      render: (row) => formatPm25(row.meanPm25),
    },
    {
      key: "difference",
      header: "Vs network",
      width: 120,
      render: (row) => formatPercent(row.percentDifference),
    },
  ];

  const recommendationColumns: Column<ReportRecommendation>[] = [
    {
      key: "recommendation",
      header: "Recommendation",
      width: 360,
      render: (row) => <CellStack primary={row.title} sub={row.body} />,
    },
    {
      key: "category",
      header: "Category",
      width: 140,
      render: (row) => <Chip>{row.category}</Chip>,
    },
  ];

  const monitoringColumns: Column<ReportMonitoringCandidate>[] = [
    {
      key: "sensor",
      header: "Sensor",
      width: 240,
      render: (row) => <CellStack primary={row.label} sub={row.reason} />,
    },
    {
      key: "difference",
      header: "Vs network",
      width: 110,
      render: (row) => formatPercent(row.percentDifference),
    },
    {
      key: "retain",
      header: "Plan",
      width: 100,
      render: (row) => <Chip variant={row.retain ? "success" : "default"}>{row.retain ? "retain" : "optional"}</Chip>,
    },
  ];

  const inputColumns: Column<ReportTemplateInput>[] = [
    {
      key: "input",
      header: "Input",
      width: 220,
      render: (row) => <CellStack primary={row.label} sub={row.description} />,
    },
    {
      key: "required",
      header: "Need",
      width: 90,
      render: (row) => <Chip variant={row.required ? "warning" : "default"}>{row.required ? "required" : "optional"}</Chip>,
    },
  ];

  const stepColumns: Column<ReportTemplateStep>[] = [
    {
      key: "step",
      header: "Step",
      width: 260,
      render: (row) => <CellStack primary={row.label} sub={row.description} />,
    },
    {
      key: "figures",
      header: "Figures",
      width: 120,
      render: (row) => String(row.figureIds.length),
    },
  ];

  if (!collection || !plan) {
    return <Loader message="Preparing report builder..." />;
  }

  return (
    <div className={styles.layout}>
      <PageHeader
        eyebrow="Report Builder"
        title="PurpleAir summary report maker"
        subtitle="Assemble a reusable study report from selected sensors, report-period settings, and the same computations used in the Houston and Smithers PDFs."
      />

      <div className={styles.stats}>
        <StatCard label="Selected sensors" value={String(activeSelectedIds.length)} />
        <StatCard label="Loaded series" value={`${loadedSeries.length}/${plan.seriesRequests.length}`} />
        <StatCard label="Network mean" value={formatPm25(summary?.networkMeanPm25)} />
        <StatCard label="Figures ready" value={`${readyFigureCount}/${plan.figures.length}`} />
        <StatCard label="Workflow steps" value={String(blueprint?.steps.length ?? 0)} />
      </div>

      <Card title="Report configuration">
        <div className={styles.configGrid}>
          <label className={styles.field}>
            <span>Community</span>
            <input value={communityName} onChange={(event) => setCommunityName(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>Start</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>End</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.titleField}`}>
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={plan.title} />
          </label>
        </div>
        <div className={styles.actions}>
          <Button size="small" variant="secondary" onClick={() => setSelectedIds(outdoorSensors.slice(0, DEFAULT_SENSOR_COUNT).map((sensor) => sensor.id))}>
            First {DEFAULT_SENSOR_COUNT}
          </Button>
          <Button size="small" variant="secondary" onClick={() => setSelectedIds(outdoorSensors.map((sensor) => sensor.id))}>
            All outdoor
          </Button>
          <Button size="small" variant="tertiary" onClick={() => setSelectedIds([])}>
            Clear
          </Button>
          <Button
            size="small"
            disabled={!exportReady}
            onClick={() => {
              if (!summary || !blueprint || !exportReady) return;
              exportReportPackage(plan, summary, blueprint);
              setExportStatus("Report package downloaded.");
            }}
          >
            Export package
          </Button>
          <Button
            size="small"
            disabled={!exportReady}
            onClick={() => {
              if (!reportDocument || !exportReady) return;
              const result = openPdfPrintView(reportDocument);
              setExportStatus(
                result === "print"
                  ? "PDF print view opened."
                  : "Popup blocked; downloaded print-ready HTML.",
              );
            }}
          >
            Open PDF print view
          </Button>
          <Button
            size="small"
            disabled={!exportReady}
            onClick={() => {
              if (!reportDocument || !exportReady) return;
              exportDocx(reportDocument);
              setExportStatus("DOCX downloaded.");
            }}
          >
            Export DOCX
          </Button>
        </div>
        {exportMessage ? <p className={styles.exportStatus}>{exportMessage}</p> : null}
      </Card>

      <Card title="Consistent add-ons">
        <div className={styles.optionGrid}>
          <label className={styles.field}>
            <span>AQMS zone</span>
            <select value={managementZone} onChange={(event) => setManagementZone(event.target.value as ReportManagementZone)}>
              <option value="unknown">Not specified</option>
              <option value="green">Green</option>
              <option value="yellow">Yellow</option>
              <option value="orange">Orange</option>
              <option value="red">Red</option>
            </select>
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={emissionInventoryEnabled} onChange={() => setEmissionInventoryEnabled((value) => !value)} />
            <span>Use emission inventory in AQMP recommendations</span>
          </label>
          <label className={styles.field}>
            <span>Emission inventory label</span>
            <input value={emissionInventoryLabel} onChange={(event) => setEmissionInventoryLabel(event.target.value)} placeholder="Emission Inventory for ..." />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={localBylawEnabled} onChange={() => setLocalBylawEnabled((value) => !value)} />
            <span>Add local bylaw warning-period recommendation</span>
          </label>
          <label className={styles.field}>
            <span>Bylaw name</span>
            <input value={localBylawName} onChange={(event) => setLocalBylawName(event.target.value)} placeholder="Solid fuel burning bylaw" />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={includeDiyCleanAir} onChange={() => setIncludeDiyCleanAir((value) => !value)} />
            <span>Include DIY clean-air-space guidance</span>
          </label>
          <label className={styles.field}>
            <span>Clean-air partner</span>
            <input value={cleanAirPartner} onChange={(event) => setCleanAirPartner(event.target.value)} placeholder="Northern Health, local health authority..." />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={sourceAttributionEnabled} onChange={() => setSourceAttributionEnabled((value) => !value)} />
            <span>Add wind/source-sector attribution</span>
          </label>
          <label className={styles.field}>
            <span>Attribution sensor</span>
            <select value={activeAttributionSensorId} onChange={(event) => setAttributionSensorId(event.target.value)}>
              <option value="">First selected sensor</option>
              {outdoorSensors.map((sensor) => (
                <option key={sensor.id} value={sensor.id}>{sensor.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Wind source</span>
            <input value={windSourceLabel} onChange={(event) => setWindSourceLabel(event.target.value)} placeholder="Courthouse meteorological tower" />
          </label>
          <label className={styles.field}>
            <span>Residential sector</span>
            <input value={residentialDirection} onChange={(event) => setResidentialDirection(event.target.value)} placeholder="east, northwest..." />
          </label>
          <label className={styles.field}>
            <span>Industrial sector</span>
            <input value={industrialDirection} onChange={(event) => setIndustrialDirection(event.target.value)} placeholder="west, south..." />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={wildfireComparison} onChange={() => setWildfireComparison((value) => !value)} />
            <span>Add with/without wildfire diurnal comparison</span>
          </label>
          <label className={styles.field}>
            <span>Wildfire exclusion region</span>
            <input value={wildfireRegion} onChange={(event) => setWildfireRegion(event.target.value)} placeholder="Stuart-Nechako smoky skies bulletins" />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={interventionMonitoring} onChange={() => setInterventionMonitoring((value) => !value)} />
            <span>Recommend smaller before/during/after intervention network</span>
          </label>
        </div>
      </Card>

      <div className={styles.reportColumns}>
        <div className={styles.reportColumn}>
          <Card title="Sensor set" className={styles.sensorCard}>
            <DataTable
              columns={sensorColumns}
              data={outdoorSensors}
              rowKey={(record) => record.id}
              emptyMessage="No outdoor sensors available."
              pageSize={12}
              footer={<span>{activeSelectedIds.length} selected</span>}
            />
          </Card>

          <Card title="Findings preview">
            {seriesError ? (
              <p className={styles.empty}>Could not load every selected sensor series.</p>
            ) : loadingSeries ? (
              <Loader message="Computing selected sensor summaries..." />
            ) : summary ? (
              <ul className={styles.findingList}>
                {summary.findings.map((finding) => (
                  <li key={finding}>{finding}</li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>Select sensors to generate findings.</p>
            )}
          </Card>

          <Card title="Generation workflow">
            <DataTable
              columns={stepColumns}
              data={blueprint?.steps ?? []}
              rowKey={(row) => row.id}
              emptyMessage="No report workflow available."
            />
          </Card>
        </div>

        <div className={styles.reportColumn}>
          <Card title="Report sections">
            <div className={styles.sectionList}>
              {plan.sections.map((section) => (
                <div className={styles.sectionItem} key={section.id}>
                  <strong>{section.title}</strong>
                  <span>{section.purpose}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Figure readiness">
            <DataTable
              columns={figureColumns}
              data={summary?.figureReadiness ?? []}
              rowKey={(row) => row.figureId}
              emptyMessage="Load selected sensor series to evaluate figure readiness."
            />
          </Card>

          <Card title="Inputs to complete">
            <div className={styles.inputAlerts}>
              {blueprint?.missingRequiredInputs.length ? (
                <div className={styles.alertBlock}>
                  <strong>Required</strong>
                  <span>{blueprint.missingRequiredInputs.join(", ")}</span>
                </div>
              ) : (
                <div className={styles.alertBlock}>
                  <strong>Required</strong>
                  <span>Core selected-sensor inputs are present.</span>
                </div>
              )}
              {blueprint?.missingOptionalInputs.length ? (
                <div className={styles.alertBlock}>
                  <strong>Optional</strong>
                  <span>{blueprint.missingOptionalInputs.join(", ")}</span>
                </div>
              ) : null}
            </div>
            <DataTable
              columns={inputColumns}
              data={[...(blueprint?.requiredInputs ?? []), ...(blueprint?.optionalInputs ?? [])]}
              rowKey={(row) => row.id}
              emptyMessage="No inputs registered."
              pageSize={8}
            />
          </Card>
        </div>
      </div>

      <Card title="Hotspot and coldspot ranking">
        <DataTable
          columns={rankingColumns}
          data={summary?.percentDifferences ?? []}
          rowKey={(row) => row.sensorId}
          emptyMessage="No ranking available for the selected sensors."
        />
      </Card>

      <div className={styles.splitGrid}>
        <Card title="Recommendation blocks">
          <DataTable
            columns={recommendationColumns}
            data={summary?.recommendations ?? []}
            rowKey={(row) => row.id}
            emptyMessage="No recommendations available yet."
          />
        </Card>
        <Card title="Future monitoring down-selection">
          <DataTable
            columns={monitoringColumns}
            data={summary?.monitoringPlan?.retainedSensors ?? []}
            rowKey={(row) => row.sensorId}
            emptyMessage="Enable intervention monitoring and load sensor series to build a retention plan."
          />
        </Card>
      </div>
    </div>
  );
}
