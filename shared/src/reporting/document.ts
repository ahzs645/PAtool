import type {
  ReportGenerationPlan,
  ReportMonitoringCandidate,
  ReportNetworkSummary,
  ReportRecommendation,
  ReportSensorMetrics,
  ReportSensorPercentDifference,
  ReportSeasonalCapture,
  ReportSectionId,
} from "./types";
import type { ReportTemplateBlueprint } from "./template";

export type ReportDocumentBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "figure"; label: string; caption: string; status: "ready" | "placeholder" };

export type ReportDocumentSection = {
  id: string;
  title: string;
  blocks: ReportDocumentBlock[];
};

export type ReportDocument = {
  title: string;
  subtitle: string;
  communityName: string;
  generatedAt: string;
  sections: ReportDocumentSection[];
};

function fmtPm25(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)} ug/m3` : "not available";
}

function fmtPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "not available";
}

function fmtCapture(valid: number, expected: number): string {
  return expected > 0 ? `${valid}/${expected} (${fmtPercent((valid / expected) * 100)})` : "not available";
}

function periodLabel(plan: ReportGenerationPlan): string {
  if (plan.period.start && plan.period.end) return `${plan.period.start} to ${plan.period.end}`;
  if (plan.period.start) return `from ${plan.period.start}`;
  if (plan.period.end) return `through ${plan.period.end}`;
  return "selected report period";
}

function zoneSentence(plan: ReportGenerationPlan): string {
  if (plan.options.managementZone === "unknown") {
    return "No AQMS management-zone status has been configured for this report.";
  }
  return `${plan.communityName} is configured as a ${plan.options.managementZone} AQMS management-zone community for this generated report.`;
}

function recommendationRows(recommendations: readonly ReportRecommendation[]): string[][] {
  return recommendations.map((recommendation) => [
    recommendation.category,
    recommendation.title,
    recommendation.body,
  ]);
}

function rankingRows(rows: readonly ReportSensorPercentDifference[]): string[][] {
  return rows.map((row) => [
    row.label,
    row.sensorId,
    fmtPm25(row.meanPm25),
    fmtPercent(row.percentDifference),
  ]);
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function monthlyNetworkRows(rows: readonly ReportSensorMetrics[]): string[][] {
  const months = new Map<string, {
    meanPm25: number[];
    p98DailyPm25: number[];
    validDailyCount: number;
    expectedDailyCount: number;
  }>();

  for (const metric of rows) {
    for (const month of metric.monthly) {
      const existing = months.get(month.month) ?? {
        meanPm25: [],
        p98DailyPm25: [],
        validDailyCount: 0,
        expectedDailyCount: 0,
      };
      if (month.meanPm25 !== null) existing.meanPm25.push(month.meanPm25);
      if (month.p98DailyPm25 !== null) existing.p98DailyPm25.push(month.p98DailyPm25);
      existing.validDailyCount += month.validDailyCount;
      existing.expectedDailyCount += month.expectedDailyCount;
      months.set(month.month, existing);
    }
  }

  return [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => [
      month,
      fmtPm25(mean(values.meanPm25)),
      fmtPm25(mean(values.p98DailyPm25)),
      fmtCapture(values.validDailyCount, values.expectedDailyCount),
    ]);
}

function seasonalLabel(row: Pick<ReportSeasonalCapture, "season" | "seasonYear">): string {
  return `${row.seasonYear} ${row.season}`;
}

function seasonalCaptureRows(rows: readonly ReportSensorMetrics[]): string[][] {
  const seasons = new Map<string, {
    label: string;
    validDailyCount: number;
    expectedDailyCount: number;
    eligibleSensors: number;
    totalSensors: number;
  }>();

  for (const metric of rows) {
    for (const season of metric.seasonalCapture) {
      const key = `${season.seasonYear}-${season.season}`;
      const existing = seasons.get(key) ?? {
        label: seasonalLabel(season),
        validDailyCount: 0,
        expectedDailyCount: 0,
        eligibleSensors: 0,
        totalSensors: 0,
      };
      existing.validDailyCount += season.validDailyCount;
      existing.expectedDailyCount += season.expectedDailyCount;
      existing.eligibleSensors += season.meetsThreshold ? 1 : 0;
      existing.totalSensors += 1;
      seasons.set(key, existing);
    }
  }

  return [...seasons.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, values]) => [
      values.label,
      fmtCapture(values.validDailyCount, values.expectedDailyCount),
      `${values.eligibleSensors}/${values.totalSensors}`,
    ]);
}

function sensorMetricRows(rows: readonly ReportSensorMetrics[]): string[][] {
  return rows.map((row) => [
    row.label,
    row.sensorId,
    fmtPm25(row.meanPm25),
    fmtPm25(row.p98DailyPm25),
    `${row.validDailyCount}/${row.expectedDailyCount}`,
    fmtPercent(row.dailyCaptureFraction * 100),
  ]);
}

function monitoringRows(rows: readonly ReportMonitoringCandidate[]): string[][] {
  return rows.map((row) => [
    row.label,
    fmtPm25(row.meanPm25),
    fmtPercent(row.percentDifference),
    row.retain ? "Retain" : "Optional",
    row.reason,
  ]);
}

function figureBlocks(
  plan: ReportGenerationPlan,
  summary: ReportNetworkSummary,
  sectionId: ReportSectionId,
): ReportDocumentBlock[] {
  return plan.figures.filter((figure) => figure.sectionId === sectionId).map((figure) => {
    const readiness = summary.figureReadiness.find((item) => item.figureId === figure.id);
    const ready = readiness?.ready ?? false;
    return {
      kind: "figure",
      label: figure.label,
      caption: ready
        ? `${figure.label}. Data requirements are satisfied; this export reserves the source-report figure slot until chart rendering is connected.`
        : `${figure.label}. Placeholder: ${readiness?.reason ?? "additional input required"}`,
      status: "placeholder",
    };
  });
}

export function buildPurpleAirReportDocument(
  plan: ReportGenerationPlan,
  summary: ReportNetworkSummary,
  blueprint: ReportTemplateBlueprint,
): ReportDocument {
  const findings = summary.findings.length ? summary.findings : ["No data-driven findings are available yet."];
  const requiredInputs = blueprint.missingRequiredInputs.length
    ? blueprint.missingRequiredInputs
    : ["Core selected-sensor inputs are present."];
  const optionalInputs = blueprint.missingOptionalInputs.length
    ? blueprint.missingOptionalInputs
    : ["Optional report inputs are configured."];

  const frontMatter: ReportDocumentSection = {
    id: "front-matter",
    title: "Front Matter",
    blocks: [
      { kind: "paragraph", text: "ENVIRONMENTAL QUALITY SERIES" },
      { kind: "paragraph", text: plan.title },
      { kind: "paragraph", text: `Generated by PAtool on ${new Date(summary.generatedAt).toLocaleDateString("en-CA")}.` },
      { kind: "paragraph", text: `Report period: ${periodLabel(plan)}.` },
    ],
  };
  const reportSections: ReportDocumentSection[] = [
    {
      id: "executive-summary",
      title: "Executive Summary",
      blocks: [
        {
          kind: "paragraph",
          text: `A community air quality monitoring report was generated for ${plan.communityName} using ${plan.sensors.length} selected PurpleAir sensor locations.`,
        },
        { kind: "list", items: findings },
      ],
    },
    {
      id: "introduction",
      title: "1 Introduction",
      blocks: [
        { kind: "paragraph", text: zoneSentence(plan) },
        {
          kind: "paragraph",
          text: "PM2.5 is formed primarily by incomplete combustion or secondary chemical reactions in the atmosphere, and it is relevant to local air quality management because it can affect respiratory and cardiovascular health.",
        },
        {
          kind: "paragraph",
          text: "This generated report follows the structure of the source PurpleAir community summary reports: it documents the sensor network, applies repeatable QC and capture rules, summarizes temporal and spatial patterns, and records management recommendations.",
        },
      ],
    },
    {
      id: "data-collection",
      title: "2 Data Collection and Sensor Locations",
      blocks: [
        {
          kind: "paragraph",
          text: `The selected network includes ${plan.sensors.length} outdoor PurpleAir sensors. Sensors are used to compare PM2.5 patterns across locations and identify relative hot and cold spots.`,
        },
        {
          kind: "table",
          columns: ["Sensor", "ID", "Latitude", "Longitude", "Location type"],
          rows: plan.sensors.map((sensor) => [
            sensor.label,
            sensor.id,
            sensor.latitude.toFixed(5),
            sensor.longitude.toFixed(5),
            sensor.locationType,
          ]),
        },
        ...figureBlocks(plan, summary, "data-collection"),
        {
          kind: "paragraph",
          text: `QC settings: A/B channel values are rejected when the absolute difference exceeds ${plan.qc.absoluteChannelDifference} ug/m3 and the relative difference exceeds ${(plan.qc.relativeChannelDifference * 100).toFixed(0)}% of the channel mean. Daily means require at least ${plan.qc.minDailyValidHours} valid hourly values. Seasonal capture target is ${(plan.qc.seasonalCaptureThreshold * 100).toFixed(0)}%.`,
        },
      ],
    },
    {
      id: "temporal-results",
      title: "3 Temporal Variability",
      blocks: [
        {
          kind: "paragraph",
          text: "Temporal summaries follow the source-report pattern by separating monthly concentration summaries, high-daily-value summaries, seasonal capture, and diurnal/weekday output slots.",
        },
        {
          kind: "table",
          columns: ["Month", "Network monthly mean PM2.5", "Network monthly 98th percentile", "Daily capture"],
          rows: monthlyNetworkRows(summary.sensorMetrics),
        },
        {
          kind: "table",
          columns: ["Season", "Daily capture", "Sensors meeting seasonal target"],
          rows: seasonalCaptureRows(summary.sensorMetrics),
        },
        ...figureBlocks(plan, summary, "temporal-results"),
      ],
    },
    {
      id: "spatial-results",
      title: "4 Spatial Variability",
      blocks: [
        { kind: "paragraph", text: `Network mean PM2.5 for the selected report inputs is ${fmtPm25(summary.networkMeanPm25)}.` },
        {
          kind: "table",
          columns: ["Sensor", "ID", "Mean PM2.5", "98th percentile daily PM2.5", "Valid days", "Capture"],
          rows: sensorMetricRows(summary.sensorMetrics),
        },
        {
          kind: "table",
          columns: ["Sensor", "ID", "Mean PM2.5", "Percent difference"],
          rows: rankingRows(summary.percentDifferences),
        },
        ...figureBlocks(plan, summary, "spatial-results"),
      ],
    },
    {
      id: "recommendations",
      title: "5 Conclusions and Recommendations",
      blocks: [
        {
          kind: "table",
          columns: ["Category", "Recommendation", "Generated text"],
          rows: recommendationRows(summary.recommendations),
        },
      ],
    },
    {
      id: "appendix",
      title: "A Appendix",
      blocks: [
        { kind: "paragraph", text: "Report-generation input status." },
        { kind: "list", items: [`Required: ${requiredInputs.join(", ")}`, `Optional: ${optionalInputs.join(", ")}`] },
        ...figureBlocks(plan, summary, "appendix"),
        {
          kind: "table",
          columns: ["Sensor", "Mean PM2.5", "Percent difference", "Future plan", "Reason"],
          rows: monitoringRows(summary.monitoringPlan?.retainedSensors ?? []),
        },
      ],
    },
  ];
  const contents: ReportDocumentSection = {
    id: "contents",
    title: "Contents",
    blocks: [{ kind: "list", items: reportSections.map((section) => section.title) }],
  };
  const sections: ReportDocumentSection[] = [frontMatter, reportSections[0], contents, ...reportSections.slice(1)];

  return {
    title: plan.title,
    subtitle: `PurpleAir Sensor Air Quality Summary Report: ${plan.communityName}`,
    communityName: plan.communityName,
    generatedAt: summary.generatedAt,
    sections,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderHtmlBlock(block: ReportDocumentBlock): string {
  if (block.kind === "paragraph") {
    return `<p>${escapeHtml(block.text)}</p>`;
  }
  if (block.kind === "list") {
    return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }
  if (block.kind === "figure") {
    return `<figure class="${block.status === "ready" ? "figure-ready" : "figure-placeholder"}"><div>${escapeHtml(block.label)}</div><figcaption>${escapeHtml(block.caption)}</figcaption></figure>`;
  }
  return [
    "<table>",
    `<thead><tr>${block.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>`,
    `<tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>",
  ].join("");
}

export function renderReportDocumentHtml(document: ReportDocument): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.title)}</title>
  <style>
    @page { margin: 0.65in; }
    body { color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; margin: 0; }
    .cover { align-items: center; border-bottom: 1px solid #9ca3af; display: flex; flex-direction: column; justify-content: center; min-height: 8in; text-align: center; }
    .series { font-size: 10pt; letter-spacing: 0.08em; text-transform: uppercase; }
    h1 { font-size: 24pt; margin: 0.35in 0 0.15in; }
	    h2 { border-bottom: 1px solid #d1d5db; font-size: 16pt; margin: 0.35in 0 0.12in; padding-bottom: 0.06in; page-break-after: avoid; }
	    p { margin: 0 0 0.12in; }
	    ul { margin: 0 0 0.16in 0.22in; padding: 0; }
	    li { margin-bottom: 0.05in; }
	    table { border-collapse: collapse; font-size: 9pt; margin: 0.12in 0 0.2in; table-layout: fixed; width: 100%; }
	    thead { display: table-header-group; }
	    tr { break-inside: avoid; page-break-inside: avoid; }
	    th, td { border: 1px solid #cbd5e1; overflow-wrap: anywhere; padding: 0.06in; text-align: left; vertical-align: top; }
    th { background: #e5e7eb; font-weight: 700; }
    figure { border: 1px solid #cbd5e1; margin: 0.14in 0 0.22in; padding: 0.16in; page-break-inside: avoid; }
    figure > div { align-items: center; background: #f3f4f6; color: #374151; display: flex; font-weight: 700; justify-content: center; min-height: 1.1in; text-align: center; }
    figcaption { color: #4b5563; font-size: 9pt; margin-top: 0.08in; }
    .figure-placeholder > div { background: repeating-linear-gradient(45deg, #f8fafc, #f8fafc 8px, #eef2f7 8px, #eef2f7 16px); }
    section { page-break-inside: auto; }
    @media print { .cover { page-break-after: always; } }
  </style>
</head>
<body>
  <main>
    <section class="cover">
      <div class="series">Environmental Quality Series</div>
      <h1>${escapeHtml(document.title)}</h1>
      <p>${escapeHtml(document.subtitle)}</p>
      <p>${escapeHtml(new Date(document.generatedAt).toLocaleDateString("en-CA"))}</p>
    </section>
    ${document.sections.map((section) => `
      <section>
        <h2>${escapeHtml(section.title)}</h2>
        ${section.blocks.map(renderHtmlBlock).join("\n")}
      </section>
    `).join("\n")}
  </main>
</body>
</html>`;
}

function escapeXml(value: string): string {
  return sanitizeXmlText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sanitizeXmlText(value: string): string {
  return Array.from(value, (char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    if (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    ) {
      return char;
    }
    return " ";
  }).join("");
}

type WordParagraphStyle = "Title" | "Subtitle" | "Heading1";

function wordRun(text: string, size = 20, bold = false): string {
  return `<w:r><w:rPr>${bold ? "<w:b/>" : "<w:b w:val=\"false\"/>"}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function wordParagraph(text: string, style?: WordParagraphStyle): string {
  const size = style === "Title" ? 34 : style === "Heading1" ? 24 : style === "Subtitle" ? 21 : 20;
  const bold = style === "Title" || style === "Heading1";
  const paragraphProps = [
    style ? `<w:pStyle w:val="${style}"/>` : "",
    `<w:spacing w:after="${style === "Title" ? 120 : 100}" w:line="276" w:lineRule="auto"/>`,
    style === "Title" || style === "Subtitle" ? "<w:keepNext/>" : "",
  ].join("");
  return `<w:p><w:pPr>${paragraphProps}</w:pPr>${wordRun(text, size, bold)}</w:p>`;
}

function wordPageBreak(): string {
  return "<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>";
}

function wordTable(columns: readonly string[], rows: readonly string[][]): string {
  const tableWidth = 10000;
  const columnWidth = Math.max(900, Math.floor(tableWidth / Math.max(columns.length, 1)));
  const cells = (row: readonly string[], header: boolean) => row.map((cell) => {
    const paragraphProps = [
      header ? "<w:pStyle w:val=\"TableHeader\"/>" : "",
      "<w:spacing w:after=\"0\" w:line=\"220\" w:lineRule=\"auto\"/>",
    ].join("");
    return [
      "<w:tc>",
      `<w:tcPr><w:tcW w:w="${columnWidth}" w:type="dxa"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>`,
      `<w:p><w:pPr>${paragraphProps}</w:pPr>${wordRun(cell, 16, header)}</w:p>`,
      "</w:tc>",
    ].join("");
  }).join("");
  return [
    "<w:tbl>",
    `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${tableWidth}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr>`,
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cells(columns, true)}</w:tr>`,
    rows.map((row) => `<w:tr>${cells(row, false)}</w:tr>`).join(""),
    "</w:tbl>",
    wordParagraph(""),
  ].join("");
}

function wordBlock(block: ReportDocumentBlock): string {
  if (block.kind === "paragraph") return wordParagraph(block.text);
  if (block.kind === "list") return block.items.map((item) => wordParagraph(`- ${item}`)).join("");
  if (block.kind === "figure") return `${wordParagraph(`[${block.status === "ready" ? "Figure" : "Figure placeholder"}] ${block.label}`)}${wordParagraph(block.caption)}`;
  return wordTable(block.columns, block.rows);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function createZip(files: Array<{ path: string; data: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const out: number[] = [];
  const central: number[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.path);
    const data = encoder.encode(file.data);
    const crc = crc32(data);
    const localOffset = offset;

    writeUint32(out, 0x04034b50);
    writeUint16(out, 20);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint16(out, 0);
    writeUint32(out, crc);
    writeUint32(out, data.length);
    writeUint32(out, data.length);
    writeUint16(out, name.length);
    writeUint16(out, 0);
    out.push(...name, ...data);
    offset = out.length;

    writeUint32(central, 0x02014b50);
    writeUint16(central, 20);
    writeUint16(central, 20);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, crc);
    writeUint32(central, data.length);
    writeUint32(central, data.length);
    writeUint16(central, name.length);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint16(central, 0);
    writeUint32(central, 0);
    writeUint32(central, localOffset);
    central.push(...name);
  }

  const centralOffset = out.length;
  out.push(...central);
  writeUint32(out, 0x06054b50);
  writeUint16(out, 0);
  writeUint16(out, 0);
  writeUint16(out, files.length);
  writeUint16(out, files.length);
  writeUint32(out, central.length);
  writeUint32(out, centralOffset);
  writeUint16(out, 0);
  return new Uint8Array(out);
}

export function renderReportDocumentDocx(document: ReportDocument): Uint8Array {
  const body = [
    wordParagraph("ENVIRONMENTAL QUALITY SERIES", "Subtitle"),
    wordParagraph(document.title, "Title"),
    wordParagraph(document.subtitle, "Subtitle"),
    wordParagraph(new Date(document.generatedAt).toLocaleDateString("en-CA")),
    wordPageBreak(),
    ...document.sections.flatMap((section) => [
      wordParagraph(section.title, "Heading1"),
      ...section.blocks.map(wordBlock),
    ]),
    "<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"936\" w:right=\"936\" w:bottom=\"936\" w:left=\"936\"/></w:sectPr>",
  ].join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:rPr><w:b/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

  return createZip([
    {
      path: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    },
    {
      path: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    },
    {
      path: "word/_rels/document.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { path: "word/document.xml", data: documentXml },
    { path: "word/styles.xml", data: stylesXml },
    {
      path: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(document.title)}</dc:title><dc:creator>PAtool</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date(document.generatedAt).toISOString()}</dcterms:created></cp:coreProperties>`,
    },
    {
      path: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PAtool</Application></Properties>`,
    },
  ]);
}
