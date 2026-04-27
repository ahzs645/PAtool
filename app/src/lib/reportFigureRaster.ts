import type {
  ReportDocument,
  ReportDocumentBlock,
  ReportDocumentDocxFigureAsset,
  ReportGenerationPlan,
  ReportNetworkSummary,
  ReportSensorMetrics,
} from "@patool/shared";

type FigureBlock = Extract<ReportDocumentBlock, { kind: "figure" }>;

function figureBlocks(document: ReportDocument): FigureBlock[] {
  return document.sections.flatMap((section) => section.blocks.filter((block): block is FigureBlock => block.kind === "figure"));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function imageLoaded(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to rasterize report figure."));
  });
}

async function svgToPngAsset(block: FigureBlock): Promise<ReportDocumentDocxFigureAsset> {
  const scale = 2;
  const blob = new Blob([block.svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    const loaded = imageLoaded(image);
    image.src = url;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(block.width * scale);
    canvas.height = Math.ceil(block.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Failed to create PNG figure asset."));
        }
      }, "image/png");
    });

    return {
      data: new Uint8Array(await pngBlob.arrayBuffer()),
      extension: "png",
      contentType: "image/png",
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const MAP = { left: 70, top: 76, width: 580, height: 220 };
const TILE_SIZE = 256;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lonToWorldX(longitude: number, zoom: number): number {
  return ((longitude + 180) / 360) * TILE_SIZE * 2 ** zoom;
}

function latToWorldY(latitude: number, zoom: number): number {
  const sin = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE_SIZE * 2 ** zoom;
}

function shortLabel(value: string, max = 22): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}.`;
}

function heatColor(value: number | null, min: number, max: number): string {
  if (value === null || !Number.isFinite(value)) return "#f8fafc";
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(0.001, max - min)));
  if (t < 0.5) {
    const local = t / 0.5;
    return `rgb(${Math.round(219 + (251 - 219) * local)},${Math.round(234 + (191 - 234) * local)},${Math.round(254 + (36 - 254) * local)})`;
  }
  const local = (t - 0.5) / 0.5;
  return `rgb(${Math.round(251 + (185 - 251) * local)},${Math.round(191 + (28 - 191) * local)},${Math.round(36 + (28 - 36) * local)})`;
}

function sensorMetricById(summary: ReportNetworkSummary): Map<string, ReportSensorMetrics> {
  return new Map(summary.sensorMetrics.map((metric) => [metric.sensorId, metric]));
}

function imageFromUrl(url: string, timeoutMs = 8000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`Timed out loading map tile: ${url}`));
    }, timeoutMs);
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Failed to load map tile: ${url}`));
    };
    image.src = url;
  });
}

function canvasDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create map tile mosaic."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to encode map tile mosaic."));
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

function chooseMapZoom(points: readonly { latitude: number; longitude: number }[]): number {
  for (let zoom = 15; zoom >= 3; zoom -= 1) {
    const xs = points.map((point) => lonToWorldX(point.longitude, zoom));
    const ys = points.map((point) => latToWorldY(point.latitude, zoom));
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= MAP.width * 0.72 && spanY <= MAP.height * 0.68) return zoom;
  }
  return 3;
}

async function buildOsmTileMosaic(points: readonly { latitude: number; longitude: number }[]) {
  const zoom = chooseMapZoom(points);
  const xs = points.map((point) => lonToWorldX(point.longitude, zoom));
  const ys = points.map((point) => latToWorldY(point.latitude, zoom));
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const viewportX = centerX - MAP.width / 2;
  const viewportY = centerY - MAP.height / 2;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = MAP.width * scale;
  canvas.height = MAP.height * scale;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");

  context.fillStyle = "#edf2f7";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const minTileX = Math.floor(viewportX / TILE_SIZE);
  const maxTileX = Math.floor((viewportX + MAP.width) / TILE_SIZE);
  const minTileY = Math.floor(viewportY / TILE_SIZE);
  const maxTileY = Math.floor((viewportY + MAP.height) / TILE_SIZE);
  const tileLimit = 2 ** zoom;
  const tileTasks: Promise<void>[] = [];

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= tileLimit) continue;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedX = ((tileX % tileLimit) + tileLimit) % tileLimit;
      const x = (tileX * TILE_SIZE - viewportX) * scale;
      const y = (tileY * TILE_SIZE - viewportY) * scale;
      const url = `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`;
      tileTasks.push(imageFromUrl(url).then((image) => {
        context.drawImage(image, x, y, TILE_SIZE * scale, TILE_SIZE * scale);
      }).catch((error) => {
        console.warn(error);
      }));
    }
  }

  await Promise.all(tileTasks);
  return {
    imageDataUrl: await canvasDataUrl(canvas),
    zoom,
    project: (latitude: number, longitude: number) => ({
      x: MAP.left + lonToWorldX(longitude, zoom) - viewportX,
      y: MAP.top + latToWorldY(latitude, zoom) - viewportY,
    }),
  };
}

async function basemapSensorFigure(
  block: FigureBlock,
  plan: ReportGenerationPlan,
  summary: ReportNetworkSummary,
): Promise<FigureBlock> {
  const metrics = sensorMetricById(summary);
  const points = plan.sensors
    .filter((sensor) => Number.isFinite(sensor.latitude) && Number.isFinite(sensor.longitude))
    .map((sensor) => ({
      id: sensor.id,
      label: sensor.label,
      latitude: sensor.latitude,
      longitude: sensor.longitude,
      meanPm25: metrics.get(sensor.id)?.meanPm25 ?? null,
    }));

  if (!points.length) return block;

  try {
    const mosaic = await buildOsmTileMosaic(points);
    const means = points.map((point) => point.meanPm25).filter(isFiniteNumber);
    const meanMin = means.length ? Math.min(...means) : 0;
    const meanMax = means.length ? Math.max(...means) : 1;
    const markers = points.map((point, index) => {
      const projected = mosaic.project(point.latitude, point.longitude);
      const fill = heatColor(point.meanPm25, meanMin, meanMax);
      const labelAnchor = projected.x > MAP.left + MAP.width - 160 ? "end" : "start";
      const labelOffset = labelAnchor === "end" ? -14 : 14;
      return [
        `<circle cx="${projected.x}" cy="${projected.y}" r="9" fill="${fill}" stroke="#0f172a" stroke-width="1.4"/>`,
        `<circle cx="${projected.x}" cy="${projected.y}" r="13" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.9"/>`,
        `<text x="${projected.x}" y="${projected.y + 4}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="8" font-weight="700" fill="#0f172a">${index + 1}</text>`,
        `<text x="${projected.x + labelOffset}" y="${projected.y + 4}" text-anchor="${labelAnchor}" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" font-family="Arial, Helvetica, sans-serif" font-size="10" font-weight="700" fill="#111827">${escapeXml(shortLabel(point.label))}</text>`,
      ].join("");
    }).join("");
    const caption = "Sensor location map. OpenStreetMap basemap with selected sensor locations; marker color follows report-period mean PM2.5.";
    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${block.width}" height="${block.height}" viewBox="0 0 ${block.width} ${block.height}" role="img" aria-label="${escapeXml(block.label)}">`,
      "<rect width=\"100%\" height=\"100%\" rx=\"10\" fill=\"#ffffff\"/>",
      "<rect x=\"1\" y=\"1\" width=\"718\" height=\"358\" rx=\"10\" fill=\"none\" stroke=\"#cbd5e1\"/>",
      `<text x="24" y="30" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" fill="#111827">${escapeXml(block.label)}</text>`,
      "<text x=\"24\" y=\"52\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"11\" fill=\"#64748b\">OpenStreetMap basemap with selected sensor locations.</text>",
      `<clipPath id="sensor-map-clip"><rect x="${MAP.left}" y="${MAP.top}" width="${MAP.width}" height="${MAP.height}"/></clipPath>`,
      `<g clip-path="url(#sensor-map-clip)"><image href="${mosaic.imageDataUrl}" x="${MAP.left}" y="${MAP.top}" width="${MAP.width}" height="${MAP.height}" preserveAspectRatio="none"/><rect x="${MAP.left}" y="${MAP.top}" width="${MAP.width}" height="${MAP.height}" fill="#ffffff" opacity="0.12"/>${markers}</g>`,
      `<rect x="${MAP.left}" y="${MAP.top}" width="${MAP.width}" height="${MAP.height}" fill="none" stroke="#94a3b8"/>`,
      "<text x=\"70\" y=\"320\" font-family=\"Arial, Helvetica, sans-serif\" font-size=\"10\" fill=\"#64748b\">Map data: OpenStreetMap contributors. Marker color follows mean PM2.5.</text>",
      "</svg>",
    ].join("");

    return {
      ...block,
      svg,
      caption,
      altText: `${block.label}. OpenStreetMap basemap at zoom ${mosaic.zoom} with selected sensor locations.`,
      status: "ready",
    };
  } catch (error) {
    console.warn(error);
    return block;
  }
}

export async function prepareReportDocumentFigures(
  document: ReportDocument,
  plan: ReportGenerationPlan,
  summary: ReportNetworkSummary,
): Promise<ReportDocument> {
  const sections: ReportDocument["sections"] = [];

  for (const section of document.sections) {
    const blocks: ReportDocumentBlock[] = [];
    for (const block of section.blocks) {
      if (block.kind === "figure" && block.label === "Sensor location map") {
        blocks.push(await basemapSensorFigure(block, plan, summary));
      } else {
        blocks.push(block);
      }
    }
    sections.push({ ...section, blocks });
  }

  return {
    ...document,
    sections,
  };
}

export async function rasterizeReportDocumentFigures(document: ReportDocument): Promise<ReportDocumentDocxFigureAsset[]> {
  return Promise.all(figureBlocks(document).map(svgToPngAsset));
}
