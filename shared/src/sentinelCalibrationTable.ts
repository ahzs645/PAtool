/**
 * SENTINEL-style calibration table with analyst sign-off and instrument
 * metadata, mirroring the `single_node_QA_Table.Rmd` /
 * `multi_node_QA_Table.Rmd` outputs.
 *
 * The table is rendered separately by the page; this module emits a
 * canonical record so PDF and HTML renderers can share the same source.
 */

export type SentinelCalibrationEntry = {
  nodeId: string;
  unitSerialNumber?: string;
  calibrationDate?: string;
  startDate?: string;
  endDate?: string;
  rCodeVersion?: string;
  analystName?: string;
  signOffDate?: string;
  notes?: string;
  baseline?: { tau: number; df: number };
  passFail?: "pass" | "fail" | "review";
};

export type SentinelCalibrationTable = {
  qaTableId: string;
  generatedAt: string;
  entries: SentinelCalibrationEntry[];
};

export function emptySentinelCalibrationTable(id = "QA-PENDING"): SentinelCalibrationTable {
  return { qaTableId: id, generatedAt: new Date(0).toISOString(), entries: [] };
}

export function renderSentinelCalibrationCsv(table: SentinelCalibrationTable): string {
  const cols = [
    "qa_table_id", "generated_at", "node_id", "unit_serial_number",
    "calibration_date", "start_date", "end_date", "rcode_version",
    "analyst_name", "sign_off_date", "baseline_tau", "baseline_df",
    "pass_fail", "notes",
  ];
  const rows = [cols.join(",")];
  for (const entry of table.entries) {
    const row = [
      table.qaTableId,
      table.generatedAt,
      entry.nodeId,
      entry.unitSerialNumber ?? "",
      entry.calibrationDate ?? "",
      entry.startDate ?? "",
      entry.endDate ?? "",
      entry.rCodeVersion ?? "",
      entry.analystName ?? "",
      entry.signOffDate ?? "",
      entry.baseline ? String(entry.baseline.tau) : "",
      entry.baseline ? String(entry.baseline.df) : "",
      entry.passFail ?? "",
      (entry.notes ?? "").replace(/[\n,]/g, " "),
    ].map(escapeCsv);
    rows.push(row.join(","));
  }
  return rows.join("\n");
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Compose a tiny PDF-ready specification (font, sizes, sections) for use
 * with the existing PAtool reporting renderer. Returns a structured
 * document description; rendering happens elsewhere.
 */
export function calibrationTableToReportSections(
  table: SentinelCalibrationTable,
): Array<{ title: string; rows: Array<{ label: string; value: string }> }> {
  return table.entries.map((entry) => ({
    title: `Node ${entry.nodeId}`,
    rows: [
      { label: "Unit S/N", value: entry.unitSerialNumber ?? "—" },
      { label: "Calibration", value: entry.calibrationDate ?? "—" },
      { label: "Window", value: `${entry.startDate ?? "—"} → ${entry.endDate ?? "—"}` },
      { label: "RCode version", value: entry.rCodeVersion ?? "—" },
      { label: "Analyst", value: entry.analystName ?? "—" },
      { label: "Sign-off", value: entry.signOffDate ?? "—" },
      { label: "Baseline (τ, df)", value: entry.baseline ? `τ=${entry.baseline.tau} df=${entry.baseline.df}` : "—" },
      { label: "Status", value: entry.passFail ?? "—" },
      { label: "Notes", value: entry.notes ?? "" },
    ],
  }));
}
