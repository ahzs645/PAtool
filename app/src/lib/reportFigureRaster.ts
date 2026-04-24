import type { ReportDocument, ReportDocumentDocxFigureAsset } from "@patool/shared";

type FigureBlock = Extract<ReportDocument["sections"][number]["blocks"][number], { kind: "figure" }>;

function figureBlocks(document: ReportDocument): FigureBlock[] {
  return document.sections.flatMap((section) => section.blocks.filter((block): block is FigureBlock => block.kind === "figure"));
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

export async function rasterizeReportDocumentFigures(document: ReportDocument): Promise<ReportDocumentDocxFigureAsset[]> {
  return Promise.all(figureBlocks(document).map(svgToPngAsset));
}
