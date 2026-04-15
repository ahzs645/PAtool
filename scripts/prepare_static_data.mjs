import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const sourceDir = resolve(root, "shared", "src", "generated");
const targetDir = resolve(root, "app", "public", "data");

if (!existsSync(sourceDir)) {
  throw new Error(`Static data source directory not found: ${sourceDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

for (const entry of readdirSync(sourceDir)) {
  if (!entry.endsWith(".json")) continue;
  copyFileSync(join(sourceDir, entry), join(targetDir, entry));
}

console.log(`Copied static fixture JSON into ${targetDir}`);
