import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sourceDir = resolve(root, "shared", "src", "generated");
const targetDir = resolve(root, "app", "public", "data");

// The static app only fetches these two assets at runtime via
// `app/src/lib/staticApi.ts`. The other generated JSON files exist for
// the `@patool/shared/fixtures` module (used in tests and Worker fallback)
// and would needlessly inflate the GitHub Pages payload by ~26 MB if
// shipped. Update this list if `staticApi.ts` starts loading new files.
const RUNTIME_ASSETS = [
  "example_pas.collection.json",
  "example_pat.series.json",
];

if (!existsSync(sourceDir)) {
  throw new Error(`Static data source directory not found: ${sourceDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

const known = new Set(readdirSync(sourceDir));
const skipped = [];
let copiedBytes = 0;

for (const entry of RUNTIME_ASSETS) {
  if (!known.has(entry)) {
    throw new Error(`Required runtime fixture missing: ${entry}`);
  }
  const sourcePath = join(sourceDir, entry);
  copyFileSync(sourcePath, join(targetDir, entry));
  copiedBytes += statSync(sourcePath).size;
}

for (const entry of known) {
  if (entry.endsWith(".json") && !RUNTIME_ASSETS.includes(entry)) {
    skipped.push(entry);
  }
}

const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
console.log(`Copied ${RUNTIME_ASSETS.length} runtime fixture(s) (${mb(copiedBytes)}) into ${targetDir}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} fixture(s) not loaded by the static app: ${skipped.join(", ")}`);
}
