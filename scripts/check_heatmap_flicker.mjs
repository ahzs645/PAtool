import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const ARTIFACT_DIR = process.env.PATOOL_HEATMAP_ARTIFACT_DIR ?? "tmp/heatmap-smoke";
const SERVER_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_200;
const WORKER_PORT = 8787;

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        server.close(() => resolve(true));
      })
      .listen(port, "127.0.0.1");
  });
}

async function findAppPort() {
  const requested = Number(process.env.PATOOL_APP_PORT ?? 5173);
  for (let port = requested; port < requested + 20; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available app port found starting at ${requested}`);
}

async function waitForServer(url, serverProcesses) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < SERVER_TIMEOUT_MS) {
    for (const serverProcess of serverProcesses) {
      if (serverProcess.exitCode != null) {
        throw new Error(`Dev server exited early with code ${serverProcess.exitCode}`);
      }
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? "no response"}`);
}

function startProcess(args, recentOutput) {
  const child = spawn("npm", args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BROWSER: "none",
      NO_UPDATE_NOTIFIER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const remember = (chunk) => {
    const text = chunk.toString();
    recentOutput.push(text);
    while (recentOutput.length > 80) recentOutput.shift();
  };

  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  return child;
}

function startDevServers(appPort) {
  const recentOutput = [];
  const worker = startProcess(["run", "dev", "--workspace", "worker", "--", "--port", String(WORKER_PORT)], recentOutput);
  const app = startProcess([
    "run",
    "dev",
    "--workspace",
    "app",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    String(appPort),
    "--strictPort",
  ], recentOutput);

  return { processes: [worker, app], recentOutput };
}

async function stopDevServers(children) {
  for (const child of children) {
    if (child.exitCode != null) continue;

    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(3_000),
    ]);
    if (child.exitCode == null) {
      child.kill("SIGKILL");
    }
  }
}

async function getHeatmapDebug(page) {
  return page.evaluate(() => window.__PAToolHeatmapDebug ?? null);
}

async function waitForKrigingRender(page) {
  await page.waitForFunction(() => {
    const debug = window.__PAToolHeatmapDebug;
    const bodyText = document.body.innerText;
    return Boolean(
      debug
      && debug.sourceRefreshes > 0
      && debug.lastJob?.method === "kriging"
      && debug.lastKrigingDiagnostics
      && bodyText.includes("Ordinary kriging")
      && bodyText.includes("sensors")
      && /\d+\s*ms/.test(bodyText),
    );
  }, null, { timeout: 30_000 });
}

async function assertHeatmapStillLive(page, label, baselineSourceRemovals) {
  await page.waitForFunction(() => {
    const debug = window.__PAToolHeatmapDebug;
    return Boolean(debug && debug.sourceRefreshes > 0 && debug.lastJob?.method === "kriging");
  }, null, { timeout: 20_000 });

  const debug = await getHeatmapDebug(page);
  if (!debug) throw new Error(`${label}: missing heatmap debug state`);
  if (debug.sourceRemovals > baselineSourceRemovals) {
    throw new Error(`${label}: heatmap source was removed after first render`);
  }
  if (debug.lastJob?.gridWidth <= 0 || debug.lastJob?.gridHeight <= 0) {
    throw new Error(`${label}: invalid kriging grid dimensions`);
  }
  if (!debug.lastKrigingDiagnostics) {
    throw new Error(`${label}: missing kriging diagnostics`);
  }
  const artifacts = debug.lastKrigingDiagnostics.artifacts;
  if (artifacts.tileBoundaryOutlierRate > 0.35) {
    throw new Error(`${label}: high kriging tile-boundary artifact rate (${(artifacts.tileBoundaryOutlierRate * 100).toFixed(1)}%)`);
  }
  if (artifacts.seamMeanRatio > 8) {
    throw new Error(`${label}: high kriging seam ratio (${artifacts.seamMeanRatio.toFixed(1)}x)`);
  }
  if (artifacts.negativeRate > 0.001 || artifacts.severeOvershootRate > 0.01) {
    throw new Error(`${label}: kriging value artifacts exceeded thresholds`);
  }
  if (debug.lastMainThreadRenderMs != null && debug.lastMainThreadRenderMs > 50) {
    throw new Error(`${label}: main-thread heatmap render exceeded 50ms (${debug.lastMainThreadRenderMs.toFixed(1)}ms)`);
  }
}

async function main() {
  await rm(ARTIFACT_DIR, { recursive: true, force: true });
  await mkdir(ARTIFACT_DIR, { recursive: true });
  if (!(await isPortAvailable(WORKER_PORT))) {
    throw new Error(`Port ${WORKER_PORT} is already in use; stop the existing worker dev server and retry.`);
  }

  const appPort = await findAppPort();
  const appUrl = process.env.PATOOL_APP_URL ?? `http://127.0.0.1:${appPort}/map`;
  const { processes: serverProcesses, recentOutput } = startDevServers(appPort);
  let browser;
  let page;

  try {
    await waitForServer(`http://127.0.0.1:${WORKER_PORT}/api/pas`, serverProcesses);
    await waitForServer(appUrl, serverProcesses);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 2200, height: 850 },
      recordVideo: { dir: ARTIFACT_DIR, size: { width: 1280, height: 720 } },
    });
    page = await context.newPage();
    const consoleErrors = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });

    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Heatmap" }).click();
    await page.locator('select:has(option[value="kriging"])').selectOption("kriging");
    await page.locator('select:has(option[value="200"])').selectOption("200");
    try {
      await waitForKrigingRender(page);
    } catch (error) {
      await page.screenshot({ path: `${ARTIFACT_DIR}/00-kriging-render-timeout.png`, fullPage: true });
      const debugDump = await page.evaluate(() => ({
        bodyText: document.body.innerText,
        heatmapDebug: window.__PAToolHeatmapDebug ?? null,
      }));
      console.error(JSON.stringify(debugDump, null, 2));
      throw error;
    }

    const baselineDebug = await getHeatmapDebug(page);
    const baselineSourceRemovals = baselineDebug?.sourceRemovals ?? 0;
    await page.screenshot({ path: `${ARTIFACT_DIR}/01-initial-wide-kriging.png`, fullPage: true });

    for (const width of [1200, 2400, 1800]) {
      await page.setViewportSize({ width, height: 850 });
      await delay(120);
    }
    await delay(SETTLE_MS);
    await assertHeatmapStillLive(page, "rapid width resize 1200-2400-1800", baselineSourceRemovals);
    await page.screenshot({ path: `${ARTIFACT_DIR}/02-after-rapid-resize.png`, fullPage: true });

    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await zoomOut.click();
    await zoomOut.click();
    await zoomIn.click();
    await zoomIn.click();
    await delay(SETTLE_MS);
    await assertHeatmapStillLive(page, "rapid zoom out/in with Follow view", baselineSourceRemovals);
    await page.screenshot({ path: `${ARTIFACT_DIR}/03-after-rapid-zoom.png`, fullPage: true });

    if (consoleErrors.length > 0) {
      throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
    }

    const finalDebug = await getHeatmapDebug(page);
    console.log(JSON.stringify({
      status: "ok",
      appUrl,
      artifacts: ARTIFACT_DIR,
      heatmapDebug: finalDebug,
    }, null, 2));

    await context.close();
  } catch (error) {
    if (page) {
      await page.screenshot({ path: `${ARTIFACT_DIR}/failure.png`, fullPage: true }).catch(() => {});
    }
    console.error(error instanceof Error ? error.message : error);
    if (recentOutput.length) {
      console.error("Recent dev server output:");
      console.error(recentOutput.join(""));
    }
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopDevServers(serverProcesses);
  }
}

main();
