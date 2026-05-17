export type AnalysisBundleFile = {
  path: string;
  mediaType: string;
  content: string;
};

export type AnalysisBundleManifest = {
  title: string;
  createdAt: string;
  source: string;
  files: Array<{ path: string; mediaType: string; bytes: number }>;
  provenance: Record<string, unknown>;
};

export type AnalysisBundle = {
  manifest: AnalysisBundleManifest;
  files: AnalysisBundleFile[];
};

export function createAnalysisBundle(input: {
  title: string;
  source: string;
  provenance?: Record<string, unknown>;
  files: AnalysisBundleFile[];
}): AnalysisBundle {
  const manifest: AnalysisBundleManifest = {
    title: input.title,
    source: input.source,
    createdAt: new Date().toISOString(),
    provenance: input.provenance ?? {},
    files: input.files.map((file) => ({
      path: file.path,
      mediaType: file.mediaType,
      bytes: new TextEncoder().encode(file.content).byteLength,
    })),
  };
  return {
    manifest,
    files: [
      { path: "manifest.json", mediaType: "application/json", content: JSON.stringify(manifest, null, 2) },
      ...input.files,
    ],
  };
}

export function objectsToCsvBundleFile<T extends Record<string, unknown>>(
  path: string,
  rows: readonly T[],
): AnalysisBundleFile {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const content = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  return { path, mediaType: "text/csv", content };
}

export function bundleToHtml(bundle: AnalysisBundle): string {
  const fileRows = bundle.manifest.files
    .map((file) => `<tr><td>${escapeHtml(file.path)}</td><td>${escapeHtml(file.mediaType)}</td><td>${file.bytes}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHtml(bundle.manifest.title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:32px;color:#172033}
table{border-collapse:collapse;width:100%;margin-top:16px}
td,th{border:1px solid #d7dde8;padding:8px;text-align:left}
pre{background:#f6f8fb;padding:16px;overflow:auto}
</style>
<h1>${escapeHtml(bundle.manifest.title)}</h1>
<p>Created ${escapeHtml(bundle.manifest.createdAt)} from ${escapeHtml(bundle.manifest.source)}.</p>
<h2>Files</h2>
<table><thead><tr><th>Path</th><th>Type</th><th>Bytes</th></tr></thead><tbody>${fileRows}</tbody></table>
<h2>Provenance</h2>
<pre>${escapeHtml(JSON.stringify(bundle.manifest.provenance, null, 2))}</pre>
</html>`;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] ?? char));
}
